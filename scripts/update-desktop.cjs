'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { packageOutput } = require('./package-desktop.cjs');
const PRODUCT = '售前解决方案工具';
const DIRECTORY = PRODUCT + '-win-x64';
const RELEASE_ZIP = /^(?:售前解决方案工具|解决方案工具|自动投标工作台)-V\d+(?:\.\d+)*-win-x64\.zip$/;

function managed(root, target) {
  const resolved = packageOutput(root, target);
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) throw new Error('Managed build paths must not be links.');
  return resolved;
}
function noLinks(directory) {
  const info = fs.lstatSync(directory);
  if (info.isSymbolicLink()) throw new Error('Refusing to remove a build tree containing a link or junction.');
  if (info.isDirectory()) for (const name of fs.readdirSync(directory)) noLinks(path.join(directory, name));
}
function removeManaged(root, target) {
  managed(root, target);
  if (!fs.existsSync(target)) return;
  noLinks(target);
  fs.rmSync(target, { recursive: fs.statSync(target).isDirectory(), force: false });
}
function hashFile(filename) {
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
  const handle = fs.openSync(filename, 'r');
  try { for (;;) { const read = fs.readSync(handle, buffer, 0, buffer.length, null); if (!read) break; hash.update(buffer.subarray(0, read)); } }
  finally { fs.closeSync(handle); }
  return hash.digest('hex');
}
function inventory(directory) {
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Installed builds must not contain links or junctions.');
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) files.push({ name: path.relative(directory, filename).replaceAll(path.sep, '/'), bytes: fs.statSync(filename).size, sha256: hashFile(filename) });
      else throw new Error('Installed build contains an unsupported file type.');
    }
  };
  noLinks(directory); visit(directory);
  return files.sort((first, second) => first.name.localeCompare(second.name, 'en'));
}
function verifyInstallation(directory, expectedVersion) {
  for (const relative of [PRODUCT + '.exe', 'build-info.json', '使用说明.txt', 'LICENSE', 'LICENSES.chromium.html', 'THIRD_PARTY_NOTICES.txt', 'resources/app/package.json', 'resources/app/LICENSE', 'resources/app/CONTENT-LICENSE.md', 'resources/app/dist/index.html', 'resources/app/dist/THIRD_PARTY_NOTICES.txt']) {
    const filename = path.join(directory, relative);
    if (!fs.existsSync(filename) || !fs.lstatSync(filename).isFile()) throw new Error(`Required release file is missing: ${relative}`);
  }
  noLinks(directory);
  const info = JSON.parse(fs.readFileSync(path.join(directory, 'build-info.json'), 'utf8'));
  const application = JSON.parse(fs.readFileSync(path.join(directory, 'resources', 'app', 'package.json'), 'utf8'));
  if (info.product !== PRODUCT || info.version !== expectedVersion || application.version !== expectedVersion) throw new Error('Release version metadata does not match package.json.');
  if (hashFile(path.join(directory, PRODUCT + '.exe')) !== info.executableSha256) throw new Error('Release executable checksum does not match build-info.json.');
  if (fs.existsSync(path.join(directory, 'resources', 'default_app.asar'))) throw new Error('The Electron sample app must not be included.');
  if (JSON.stringify(fs.readdirSync(path.join(directory, 'locales')).sort()) !== JSON.stringify(['en-US.pak', 'zh-CN.pak'])) throw new Error('Release locales must contain only English and Simplified Chinese.');
  return info;
}
function runCommand(command, args, { cwd, env = process.env, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Command failed with exit code ${code}: ${path.basename(command)}`)));
  });
}
function powerShell(environment = process.env) {
  const candidates = [
    environment.ProgramFiles && path.join(environment.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
    ...(environment.PATH || environment.Path || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, 'pwsh.exe')),
    environment.SystemRoot && path.join(environment.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  return candidates.find(filename => filename && fs.existsSync(filename)) || 'powershell.exe';
}
async function closeCurrentInstallation(executable, { environment = process.env, run = runCommand, root } = {}) {
  const script = `$ErrorActionPreference='Stop'; $target=[IO.Path]::GetFullPath($env:PRESALES_UPDATE_EXECUTABLE); $name=[IO.Path]::GetFileNameWithoutExtension($target); function Matching { @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -ieq $target } catch { $false } }) }; $running=Matching; foreach($item in $running){ if($item.MainWindowHandle -ne 0){ [void]$item.CloseMainWindow() } }; $watch=[Diagnostics.Stopwatch]::StartNew(); while((Matching).Count -gt 0){ if($watch.Elapsed.TotalSeconds -gt 30){ throw 'The current app did not close normally. No process was killed. Close it and retry.' }; Start-Sleep -Milliseconds 200 }`;
  await run(powerShell(environment), ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { cwd: root, env: { ...environment, PRESALES_UPDATE_EXECUTABLE: executable } });
}
async function archiveAndVerify(source, destination, { environment = process.env, run = runCommand, root } = {}) {
  const manifestFile = managed(root, path.join(root, 'release', '.archive-manifest.json'));
  const manifest = { prefix: path.basename(source) + '/', files: inventory(source) };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest), { flag: 'wx' });
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $source=$env:PRESALES_UPDATE_SOURCE; $zip=$env:PRESALES_UPDATE_ZIP; $manifest=Get-Content -LiteralPath $env:PRESALES_UPDATE_MANIFEST -Raw -Encoding UTF8 | ConvertFrom-Json; [IO.Compression.ZipFile]::CreateFromDirectory($source,$zip,[IO.Compression.CompressionLevel]::Optimal,$true); $archive=[IO.Compression.ZipFile]::OpenRead($zip); try { $entries=@($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') }); if($entries.Count -ne $manifest.files.Count){throw 'ZIP file count mismatch'}; foreach($record in $manifest.files){ $entry=$archive.GetEntry($manifest.prefix+$record.name); if($null -eq $entry -or $entry.Length -ne $record.bytes){throw 'ZIP entry mismatch'}; $stream=$entry.Open(); $sha=[Security.Cryptography.SHA256]::Create(); try { $actual=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant(); if($actual -ne $record.sha256){throw 'ZIP checksum mismatch'} } finally { $sha.Dispose(); $stream.Dispose() } } } finally { $archive.Dispose() }`;
  try {
    await run(powerShell(environment), ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { cwd: root, env: { ...environment, PRESALES_UPDATE_SOURCE: source, PRESALES_UPDATE_ZIP: destination, PRESALES_UPDATE_MANIFEST: manifestFile } });
  } finally { removeManaged(root, manifestFile); }
}
async function updateDesktop({ root = path.resolve(__dirname, '..'), environment = process.env, skipBuild = false, run = runCommand, closeCurrent = closeCurrentInstallation, archive = archiveAndVerify } = {}) {
  root = path.resolve(root);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Package version must contain three numeric components.');
  const release = path.join(root, 'release');
  fs.mkdirSync(release, { recursive: true });
  const current = managed(root, path.join(release, DIRECTORY));
  const candidate = managed(root, path.join(release, '.candidate'));
  const previous = managed(root, path.join(release, '.previous'));
  const candidateLauncher = managed(root, path.join(release, '.candidate-launcher.exe'));
  const previousLauncher = managed(root, path.join(release, '.previous-launcher.exe'));
  const previousZip = managed(root, path.join(release, '.previous-package.zip'));
  const temporaryZip = managed(root, path.join(release, '.package.tmp.zip'));
  const finalZip = managed(root, path.join(release, `${PRODUCT}-V${version}-win-x64.zip`));
  const launcher = path.join(root, PRODUCT + '.exe');
  if (fs.existsSync(launcher) && fs.lstatSync(launcher).isSymbolicLink()) throw new Error('The launcher must not be a link.');
  for (const filename of [previous, previousLauncher, previousZip]) if (fs.existsSync(filename)) throw new Error('An unfinished update backup exists. Preserve it and restore the previous installation before retrying.');
  const lock = managed(root, path.join(release, '.update.lock'));
  const lockHandle = fs.openSync(lock, 'wx');
  fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  let oldMoved = false, installed = false, launcherMoved = false, launcherInstalled = false, zipMoved = false, zipInstalled = false, committed = false;
  try {
    for (const filename of [candidate, candidateLauncher, temporaryZip]) removeManaged(root, filename);
    if (!skipBuild) await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, env: environment, shell: process.platform === 'win32' });
    await run(process.execPath, [path.join(root, 'scripts', 'package-desktop.cjs'), '--output', candidate], { cwd: root, env: environment });
    verifyInstallation(candidate, version);
    const expectedFiles = inventory(candidate);
    await run(powerShell(environment), ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'build-launcher.ps1'), '-OutputPath', candidateLauncher], { cwd: root, env: environment });
    if (!fs.existsSync(candidateLauncher) || !fs.lstatSync(candidateLauncher).isFile()) throw new Error('The candidate launcher was not produced.');
    const smoke = path.join(root, 'tests', 'desktop', 'smoke-installed.cjs');
    await run(process.execPath, [smoke], { cwd: root, env: { ...environment, PRESALES_SOLUTION_TOOL_EXECUTABLE: path.join(candidate, PRODUCT + '.exe') } });
    if (fs.existsSync(current)) await closeCurrent(path.join(current, PRODUCT + '.exe'), { environment, run, root });
    if (fs.existsSync(current)) { fs.renameSync(current, previous); oldMoved = true; }
    fs.renameSync(candidate, current); installed = true;
    if (fs.existsSync(launcher)) { fs.renameSync(launcher, previousLauncher); launcherMoved = true; }
    fs.renameSync(candidateLauncher, launcher); launcherInstalled = true;
    verifyInstallation(current, version);
    if (JSON.stringify(inventory(current)) !== JSON.stringify(expectedFiles)) throw new Error('Installed files changed during promotion.');
    await run(process.execPath, [smoke], { cwd: root, env: { ...environment, PRESALES_SOLUTION_TOOL_EXECUTABLE: path.join(current, PRODUCT + '.exe') } });
    await archive(current, temporaryZip, { environment, run, root });
    const zipSha256 = hashFile(temporaryZip);
    if (fs.existsSync(finalZip)) { fs.renameSync(finalZip, previousZip); zipMoved = true; }
    fs.renameSync(temporaryZip, finalZip); zipInstalled = true;
    committed = true;
    const cleanupWarnings = [];
    for (const filename of [previous, previousLauncher, previousZip, path.join(release, 'history'), ...fs.readdirSync(release).filter(name => RELEASE_ZIP.test(name) && path.join(release, name) !== finalZip).map(name => path.join(release, name))]) {
      try { removeManaged(root, filename); } catch (error) { cleanupWarnings.push(error.message); }
    }
    return { version, executable: path.join(current, PRODUCT + '.exe'), launcher, zip: finalZip, sha256: zipSha256, cleanupWarnings };
  } catch (error) {
    if (!committed) {
      try {
        if (installed) { await closeCurrent(path.join(current, PRODUCT + '.exe'), { environment, run, root }); removeManaged(root, current); }
        if (oldMoved) fs.renameSync(previous, current);
        if (launcherInstalled && fs.existsSync(launcher)) fs.unlinkSync(launcher);
        if (launcherMoved) fs.renameSync(previousLauncher, launcher);
        if (zipInstalled) removeManaged(root, finalZip);
        if (zipMoved) fs.renameSync(previousZip, finalZip);
      } catch (rollbackError) { error.message += ` Rollback could not finish: ${rollbackError.message}. Preserve release/.previous for recovery.`; }
    }
    throw error;
  } finally {
    for (const filename of [candidate, candidateLauncher, temporaryZip]) { try { removeManaged(root, filename); } catch {} }
    fs.closeSync(lockHandle); fs.unlinkSync(lock);
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(argument => argument !== '--skip-build') || args.length > 1) { console.error('Usage: node scripts/update-desktop.cjs [--skip-build]'); process.exitCode = 1; }
  else updateDesktop({ skipBuild: args.includes('--skip-build') }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
module.exports = { updateDesktop, managed, removeManaged, hashFile, inventory, verifyInstallation, powerShell, archiveAndVerify, closeCurrentInstallation };
