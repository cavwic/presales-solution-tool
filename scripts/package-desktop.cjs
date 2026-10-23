'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { resolveBuildPaths } = require('./build-paths.cjs');
const ROOT = path.resolve(__dirname, '..');
const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const versionParts = [...appVersion.split('.').map(Number), 0];
const PRODUCT_DIRECTORY = '售前解决方案工具-win-x64';
function packageOutput(root, value) {
  const release = path.join(root, 'release');
  const output = value ? path.resolve(root, value) : path.join(release, PRODUCT_DIRECTORY);
  const relative = path.relative(release, output);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Package output must be a child of this project release directory.');
  let current = root;
  for (const part of path.relative(root, output).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Package output must not contain a link or junction.');
  }
  return output;
}
function runtimeFilter(runtime, entry) {
  const relative = path.relative(runtime, entry).replaceAll(path.sep, '/');
  if (relative === 'resources/default_app.asar') return false;
  return !relative.startsWith('locales/') || ['locales/en-US.pak', 'locales/zh-CN.pak'].includes(relative);
}
async function packageDesktop({ output: requestedOutput } = {}) {
const { electronDist: runtime, buildModules: toolModules } = resolveBuildPaths({ root: ROOT });
const output = packageOutput(ROOT, requestedOutput);
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('Run npm run build first');
for (const filename of ['LICENSE', 'LICENSES.chromium.html', 'locales/en-US.pak', 'locales/zh-CN.pak']) if (!fs.existsSync(path.join(runtime, filename))) throw new Error(`Electron runtime is incomplete: ${filename}`);
if (!fs.existsSync(path.join(ROOT, 'dist', 'THIRD_PARTY_NOTICES.txt'))) throw new Error('Build third-party notices before packaging.');
if (fs.existsSync(output)) throw new Error('Package output already exists. Use npm run update:desktop to validate and replace the installed build.');
function copyTree(source, destination, filter = () => true) {
  if (!filter(source)) return;
  const info = fs.lstatSync(source);
  if (info.isSymbolicLink()) throw new Error('Package inputs must not contain symbolic links or junctions.');
  if (info.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) copyTree(path.join(source, name), path.join(destination, name), filter);
  } else fs.copyFileSync(source, destination);
}
fs.mkdirSync(output, { recursive: true });
copyTree(runtime, output, entry => runtimeFilter(runtime, entry));
fs.renameSync(path.join(output, 'electron.exe'), path.join(output, '售前解决方案工具.exe'));
const appRoot = path.join(output, 'resources', 'app');
fs.mkdirSync(appRoot, { recursive: true });
for (const dir of ['desktop', 'dist', 'assets']) copyTree(path.join(ROOT, dir), path.join(appRoot, dir), (entry) => !entry.endsWith('.test.cjs'));
for (const file of ['LICENSE', 'CONTENT-LICENSE.md']) fs.copyFileSync(path.join(ROOT, file), path.join(appRoot, file));
fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'cavwic-presales-solution-tool', productName: '售前解决方案工具', version: appVersion, main: 'desktop/main.cjs', license: 'MIT' }, null, 2));
const requireTools = createRequire(path.join(toolModules, '__build.cjs'));
const pe = requireTools('pe-library');
const resedit = await requireTools('resedit/cjs').load();
const exePath = path.join(output, '售前解决方案工具.exe');
const binary = pe.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const resource = pe.NtExecutableResource.from(binary);
const icon = resedit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'assets', 'presales-solution-tool.ico')));
const groups = resedit.Resource.IconGroupEntry.fromEntries(resource.entries);
for (const group of groups) resedit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, group.id, group.lang, icon.icons.map((item) => item.data));
const version = resedit.Resource.VersionInfo.fromEntries(resource.entries)[0];
if (version) {
  version.setFileVersion(...versionParts);
  version.setProductVersion(...versionParts);
  for (const language of version.getAllLanguagesForStringValues()) version.setStringValues(language, { FileDescription: '售前解决方案工具', ProductName: '售前解决方案工具', CompanyName: 'CAVWIC', OriginalFilename: '售前解决方案工具.exe', InternalName: 'PresalesSolutionTool', LegalCopyright: 'CAVWIC · MIT License' });
  version.outputToResourceEntries(resource.entries);
}
resource.outputResource(binary);
fs.writeFileSync(exePath, Buffer.from(binary.generate()));
const sha256 = createHash('sha256').update(fs.readFileSync(exePath)).digest('hex');
fs.writeFileSync(path.join(output, '使用说明.txt'), fs.readFileSync(path.join(ROOT, 'docs', '使用说明.txt')));
fs.copyFileSync(path.join(ROOT, 'dist', 'THIRD_PARTY_NOTICES.txt'), path.join(output, 'THIRD_PARTY_NOTICES.txt'));
fs.writeFileSync(path.join(output, 'build-info.json'), JSON.stringify({ product: '售前解决方案工具', version: appVersion, builtAt: new Date().toISOString(), electron: fs.readFileSync(path.join(runtime, 'version'), 'utf8').trim(), source: 'cavwic-solutions-lab local checkout; desktop adaptation', executableSha256: sha256, dataDirectory: '%APPDATA%\\CavwicBidWorkbench', noNodeOrAstroRequired: true }, null, 2));
return { output, executable: exePath, sha256 };
}
function argumentsOf(args) {
  if (!args.length) return {};
  if (args.length === 2 && args[0] === '--output' && args[1]) return { output: args[1] };
  throw new Error('Usage: node scripts/package-desktop.cjs [--output release/<candidate-directory>]');
}
if (require.main === module) {
  Promise.resolve().then(() => packageDesktop(argumentsOf(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
module.exports = { packageDesktop, packageOutput, runtimeFilter, argumentsOf };
