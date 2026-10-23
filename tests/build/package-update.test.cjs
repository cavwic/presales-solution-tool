'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveElectronDist, resolveBuildPaths } = require('../../scripts/build-paths.cjs');
const { packageOutput, runtimeFilter, argumentsOf } = require('../../scripts/package-desktop.cjs');
const { updateDesktop, removeManaged, hashFile, verifyInstallation, archiveAndVerify, closeCurrentInstallation } = require('../../scripts/update-desktop.cjs');
const PRODUCT = '售前解决方案工具', DIRECTORY = PRODUCT + '-win-x64';

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'presales-package-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.6.0' }));
  return root;
}
function write(root, relative, value = 'fixture') {
  const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); return target;
}
function fakeRuntime(root, relative) { const directory = path.join(root, relative); write(directory, 'electron.exe'); return directory; }
function fakeModules(root, relative) {
  const directory = path.join(root, relative);
  write(directory, 'pe-library/package.json', JSON.stringify({ main: 'index.js' })); write(directory, 'pe-library/index.js');
  write(directory, 'resedit/package.json', JSON.stringify({ exports: { './cjs': './index.cjs' } })); write(directory, 'resedit/index.cjs');
  return directory;
}
function installation(directory, version) {
  for (const relative of ['使用说明.txt', 'LICENSE', 'LICENSES.chromium.html', 'THIRD_PARTY_NOTICES.txt', 'resources/app/LICENSE', 'resources/app/CONTENT-LICENSE.md', 'resources/app/dist/index.html', 'resources/app/dist/THIRD_PARTY_NOTICES.txt', 'locales/en-US.pak', 'locales/zh-CN.pak']) write(directory, relative);
  const executable = write(directory, PRODUCT + '.exe', `executable-${version}`);
  write(directory, 'resources/app/package.json', JSON.stringify({ version }));
  write(directory, 'build-info.json', JSON.stringify({ product: PRODUCT, version, executableSha256: hashFile(executable) }));
}
function updaterFixture(t, failure = '') {
  const root = fixture(t), current = path.join(root, 'release', DIRECTORY);
  installation(current, '1.5.0'); write(root, PRODUCT + '.exe', 'old-launcher');
  write(root, 'release/售前解决方案工具-V1.5.0-win-x64.zip', 'old-archive'); write(root, 'release/history/old.zip', 'old-history');
  const calls = []; let smokeCount = 0;
  const run = async (command, args, options) => {
    if (args[0] === 'run') { calls.push('build'); if (failure === 'build') throw new Error('build failed'); }
    else if (args[0].endsWith('package-desktop.cjs')) { calls.push('package'); installation(args.at(-1), '1.6.0'); }
    else if (args.includes('-OutputPath')) { calls.push('launcher'); fs.writeFileSync(args.at(-1), 'new-launcher'); }
    else if (args[0].endsWith('smoke-installed.cjs')) {
      calls.push(`smoke-${++smokeCount}`);
      const actual = options.env.PRESALES_SOLUTION_TOOL_EXECUTABLE;
      assert.equal(path.basename(actual), PRODUCT + '.exe');
      assert.equal(path.basename(path.dirname(actual)), smokeCount === 1 ? '.candidate' : DIRECTORY);
      if (failure === `smoke-${smokeCount}`) throw new Error('smoke failed');
    } else throw new Error('Unexpected command: ' + command);
  };
  const closeCurrent = async target => { calls.push('close'); assert.equal(target, path.join(current, PRODUCT + '.exe')); if (failure === 'close') throw new Error('app stayed open'); };
  const archive = async (source, target) => { calls.push('archive'); assert.equal(source, current); assert(fs.existsSync(path.join(root, 'release', '.previous'))); if (failure === 'archive') throw new Error('archive failed'); fs.writeFileSync(target, 'verified-archive'); };
  return { root, current, calls, options: { root, environment: {}, run, closeCurrent, archive } };
}

test('build paths prefer environment then local configuration and preserve legacy variable aliases', t => {
  const root = fixture(t), configured = fakeRuntime(root, 'configured-runtime'), explicit = fakeRuntime(root, 'explicit-runtime');
  const modules = fakeModules(root, 'configured/node_modules');
  write(root, 'config/local-build.json', JSON.stringify({ electronDist: configured, buildModules: modules }));
  assert.deepEqual(resolveBuildPaths({ root, environment: {} }), { electronDist: configured, buildModules: modules });
  assert.equal(resolveElectronDist({ root, environment: { PRESALES_SOLUTION_TOOL_ELECTRON_DIST: explicit, BID_ELECTRON_DIST: 'invalid-old' } }), explicit);
  assert.equal(resolveElectronDist({ root, environment: { BID_ELECTRON_DIST: explicit } }), explicit);
  assert.throws(() => resolveElectronDist({ root, environment: { PRESALES_SOLUTION_TOOL_ELECTRON_DIST: 'missing-runtime' } }), /incomplete/);
});

test('fresh source builds resolve declared local packages without any machine path or installation', t => {
  const root = fixture(t), modules = fakeModules(root, 'node_modules');
  write(root, 'node_modules/electron/package.json', JSON.stringify({ name: 'electron', main: 'index.js' }));
  const electronDist = fakeRuntime(root, 'node_modules/electron/dist');
  assert.deepEqual(resolveBuildPaths({ root, environment: {} }), { electronDist, buildModules: modules });
  write(root, 'config/local-build.json', '{broken');
  assert.throws(() => resolveElectronDist({ root, environment: {} }), /valid JSON/);
});

test('package outputs stay under release, reject links and never delete a shared dependency target', t => {
  const root = fixture(t), outside = path.join(root, 'external-dependencies');
  write(outside, 'keep.txt', 'shared dependencies'); fs.mkdirSync(path.join(root, 'release'));
  assert.throws(() => packageOutput(root, root), /child/);
  assert.throws(() => packageOutput(root, path.join(root, '..', 'outside')), /child/);
  const linked = path.join(root, 'release', 'linked');
  fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => packageOutput(root, linked), /link/);
  assert.throws(() => removeManaged(root, linked), /link/);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'shared dependencies');
  assert.deepEqual(argumentsOf(['--output', 'release/.candidate']), { output: 'release/.candidate' });
  assert.throws(() => argumentsOf(['--force']), /Usage/);
});

test('runtime pruning keeps licenses and English/Chinese while excluding other locales and the sample app', () => {
  const runtime = path.resolve('fixture-runtime');
  for (const entry of ['LICENSE', 'LICENSES.chromium.html', 'locales', 'locales/en-US.pak', 'locales/zh-CN.pak']) assert.equal(runtimeFilter(runtime, path.join(runtime, entry)), true);
  for (const entry of ['resources/default_app.asar', 'locales/fr.pak', 'locales/zh-TW.pak']) assert.equal(runtimeFilter(runtime, path.join(runtime, entry)), false);
});

test('successful update validates before closing and keeps only current runtime, launcher and ZIP', async t => {
  const { root, current, calls, options } = updaterFixture(t);
  write(root, 'release/business.zip', 'user-supplied business archive');
  const result = await updateDesktop(options);
  assert.equal(result.version, '1.6.0'); assert.deepEqual(result.cleanupWarnings, []);
  assert.deepEqual(calls, ['build', 'package', 'launcher', 'smoke-1', 'close', 'smoke-2', 'archive']);
  assert.equal(verifyInstallation(current, '1.6.0').version, '1.6.0');
  assert.equal(fs.readFileSync(path.join(root, PRODUCT + '.exe'), 'utf8'), 'new-launcher');
  assert.deepEqual(fs.readdirSync(path.join(root, 'release')).sort(), [DIRECTORY, PRODUCT + '-V1.6.0-win-x64.zip', 'business.zip'].sort());
  assert.equal(fs.readFileSync(path.join(root, 'release', 'business.zip'), 'utf8'), 'user-supplied business archive');
});

test('build or candidate-smoke failure never closes or replaces the stable installation', async t => {
  for (const failure of ['build', 'smoke-1']) {
    const { root, current, calls, options } = updaterFixture(t, failure);
    await assert.rejects(updateDesktop(options), /failed/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(current, 'build-info.json'))).version, '1.5.0');
    assert.equal(calls.includes('close'), false);
    assert.equal(fs.readFileSync(path.join(root, PRODUCT + '.exe'), 'utf8'), 'old-launcher');
    assert.equal(fs.existsSync(path.join(root, 'release', 'history', 'old.zip')), true);
    assert.equal(fs.existsSync(path.join(root, 'release', '.candidate')), false);
  }
});

test('failed normal close leaves the stable version and all existing release archives intact', async t => {
  const { root, current, options } = updaterFixture(t, 'close');
  await assert.rejects(updateDesktop(options), /stayed open/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(current, 'build-info.json'))).version, '1.5.0');
  assert.equal(fs.existsSync(path.join(root, 'release', PRODUCT + '-V1.5.0-win-x64.zip')), true);
  assert.equal(fs.existsSync(path.join(root, 'release', 'history', 'old.zip')), true);
});

test('installed-smoke and ZIP failures restore stable runtime and launcher and retain prior archives', async t => {
  for (const failure of ['smoke-2', 'archive']) {
    const { root, current, options } = updaterFixture(t, failure);
    await assert.rejects(updateDesktop(options), /failed/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(current, 'build-info.json'))).version, '1.5.0');
    assert.equal(fs.readFileSync(path.join(root, PRODUCT + '.exe'), 'utf8'), 'old-launcher');
    assert.equal(fs.existsSync(path.join(root, 'release', PRODUCT + '-V1.5.0-win-x64.zip')), true);
    assert.equal(fs.existsSync(path.join(root, 'release', 'history', 'old.zip')), true);
    assert.equal(fs.existsSync(path.join(root, 'release', '.previous')), false);
  }
});

test('update refuses concurrent or unfinished swaps without erasing their recovery copy', async t => {
  const { root, options } = updaterFixture(t);
  write(root, 'release/.update.lock', 'active');
  await assert.rejects(updateDesktop(options), { code: 'EEXIST' });
  fs.unlinkSync(path.join(root, 'release', '.update.lock'));
  write(root, 'release/.previous/recovery.txt', 'preserve');
  await assert.rejects(updateDesktop(options), /unfinished/);
  assert.equal(fs.readFileSync(path.join(root, 'release', '.previous', 'recovery.txt'), 'utf8'), 'preserve');
});

test('normal-close and ZIP helpers use data-only environment paths and verify a complete archive manifest', async t => {
  const root = fixture(t), source = path.join(root, 'release', DIRECTORY), zip = path.join(root, 'release', 'fixture.zip');
  installation(source, '1.6.0');
  await closeCurrentInstallation(path.join(source, PRODUCT + '.exe'), { root, environment: {}, run: async (_command, args, options) => {
    assert.match(args.at(-1), /CloseMainWindow/); assert.doesNotMatch(args.at(-1), /Stop-Process|taskkill|\.Kill\(/);
    assert.equal(options.env.PRESALES_UPDATE_EXECUTABLE, path.join(source, PRODUCT + '.exe'));
  } });
  await archiveAndVerify(source, zip, { root, environment: {}, run: async (_command, args, options) => {
    const manifest = JSON.parse(fs.readFileSync(options.env.PRESALES_UPDATE_MANIFEST));
    assert.equal(manifest.prefix, DIRECTORY + '/');
    assert(manifest.files.some(file => file.name === 'LICENSES.chromium.html' && file.sha256));
    assert.match(args.at(-1), /ComputeHash/); assert.match(args.at(-1), /ZIP file count mismatch/);
    assert.equal(options.env.PRESALES_UPDATE_ZIP, zip);
  } });
  assert.equal(fs.existsSync(path.join(root, 'release', '.archive-manifest.json')), false);
});
