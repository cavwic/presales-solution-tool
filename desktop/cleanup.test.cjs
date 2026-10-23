'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCleanupService, attachCleanup } = require('./cleanup.cjs');

async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'presales-cleanup-test-'));
  const userData = path.join(base, 'app-data');
  await fs.mkdir(path.join(userData, 'previews', 'preview-a'), { recursive: true });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let size = 120, cleared = 0;
  const session = { getCacheSize: async () => size, clearCache: async () => { cleared++; size = 0; } };
  const service = createCleanupService({ userData, session, ...options });
  return { base, userData, session, service, cleared: () => cleared };
}

test('cleanup preview is read-only; chosen cache and temporary files clear without touching settings, backups or user files', async t => {
  const { base, userData, service, cleared } = await fixture(t);
  const preserved = ['IndexedDB/project.data', 'Local Storage/model.settings', 'file-backups/original.bak', 'authorized-folders.json', 'model-config.json', 'projects/input.txt', 'models/weights.bin'];
  for (const name of preserved) { await fs.mkdir(path.dirname(path.join(userData, name)), { recursive: true }); await fs.writeFile(path.join(userData, name), name); }
  const external = path.join(base, 'user-project.txt');
  await fs.writeFile(external, 'source');
  const temporary = path.join(userData, 'previews', 'preview-a', '结果.txt');
  await fs.writeFile(temporary, 'hello');
  const preview = await service.preview();
  assert.equal(cleared(), 0);
  assert.equal(await fs.readFile(temporary, 'utf8'), 'hello');
  assert.deepEqual(preview.categories[1], { id: 'previews', count: 1, bytes: 5, files: [{ name: 'preview-a/结果.txt', bytes: 5 }] });
  const result = await service.run({ token: preview.token, categories: ['runtime-cache', 'previews'] });
  assert.deepEqual(result.categories, [{ id: 'runtime-cache', count: 1, bytes: 120, failed: 0 }, { id: 'previews', count: 1, bytes: 5, failed: 0 }]);
  assert.deepEqual(result.errors, []);
  assert.equal(cleared(), 1);
  await assert.rejects(fs.stat(temporary), { code: 'ENOENT' });
  for (const name of preserved) assert.equal(await fs.readFile(path.join(userData, name), 'utf8'), name);
  assert.equal(await fs.readFile(external, 'utf8'), 'source');
});

test('cleanup retains files created or changed after preview and consumes the confirmation once', async t => {
  const { userData, service, cleared } = await fixture(t);
  const folder = path.join(userData, 'previews', 'preview-a');
  await fs.writeFile(path.join(folder, 'changed.txt'), 'old');
  await fs.writeFile(path.join(folder, 'same.txt'), 'same');
  const preview = await service.preview();
  await fs.writeFile(path.join(folder, 'changed.txt'), 'new');
  await fs.writeFile(path.join(folder, 'new.txt'), 'new');
  const result = await service.run({ token: preview.token, categories: ['previews'] });
  assert.deepEqual(result.categories, [{ id: 'previews', count: 1, bytes: 4, failed: 1 }]);
  assert.match(result.errors[0].message, /改变/);
  assert.equal(await fs.readFile(path.join(folder, 'changed.txt'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(folder, 'new.txt'), 'utf8'), 'new');
  assert.equal(cleared(), 0);
  await assert.rejects(service.run({ token: preview.token, categories: ['previews'] }), { code: 'EXPIRED_PREVIEW' });
});

test('cleanup rejects arbitrary paths, categories, stale tokens and duplicate selections', async t => {
  let time = 0;
  const { service } = await fixture(t, { now: () => time });
  const preview = await service.preview();
  for (const input of [null, {}, { token: preview.token, categories: [] }, { token: preview.token, categories: ['../projects'] },
    { token: preview.token, categories: ['previews', 'previews'] }, { token: preview.token, categories: ['previews'], path: '../project' }]) {
    await assert.rejects(service.run(input), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(service.preview({ path: 'projects' }), { code: 'INVALID_INPUT' });
  await assert.rejects(service.run({ token: 'forged', categories: ['runtime-cache'] }), { code: 'EXPIRED_PREVIEW' });
  time = 600001;
  await assert.rejects(service.run({ token: preview.token, categories: ['previews'] }), { code: 'EXPIRED_PREVIEW' });
});

test('cleanup never traverses preview junctions and refuses a replaced preview root', async t => {
  const { base, userData, service } = await fixture(t);
  const outside = path.join(base, 'outside');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), 'outside');
  const junction = path.join(userData, 'previews', 'linked');
  try { await fs.symlink(outside, junction, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) { t.skip('Test links unavailable.'); return; } throw error; }
  assert.equal((await service.preview()).categories[1].count, 0);
  const actual = path.join(userData, 'previews', 'preview-a', 'file.txt');
  await fs.writeFile(actual, 'old');
  const preview = await service.preview();
  await fs.rename(path.join(userData, 'previews'), path.join(userData, 'old-previews'));
  await fs.symlink(outside, path.join(userData, 'previews'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await service.run({ token: preview.token, categories: ['previews'] });
  assert.equal(result.categories[0].failed, 1);
  await assert.rejects(service.preview(), { code: 'UNSAFE_PATH' });
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'outside');
  assert.equal(await fs.readFile(path.join(userData, 'old-previews', 'preview-a', 'file.txt'), 'utf8'), 'old');
});

test('cleanup reports per-category cache errors and per-file permission failures while continuing', async t => {
  const failingIo = Object.create(fs);
  failingIo.unlink = async filename => { if (filename.endsWith('locked.txt')) throw Object.assign(new Error('secret path'), { code: 'EACCES' }); return fs.unlink(filename); };
  const { userData, service } = await fixture(t, { io: failingIo, getLocale: () => 'en', session: { getCacheSize: async () => 4, clearCache: async () => { throw new Error('private detail'); } } });
  await fs.writeFile(path.join(userData, 'previews', 'preview-a', 'locked.txt'), 'lock');
  await fs.writeFile(path.join(userData, 'previews', 'preview-a', 'free.txt'), 'free');
  const preview = await service.preview();
  const result = await service.run({ token: preview.token, categories: ['runtime-cache', 'previews'] });
  assert.deepEqual(result.categories, [{ id: 'runtime-cache', count: 0, bytes: 0, failed: 1 }, { id: 'previews', count: 1, bytes: 4, failed: 1 }]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[1].message, /permissions/);
  assert.doesNotMatch(JSON.stringify(result.errors), /private detail|secret path|[\u3400-\u9fff]/);
  assert.equal(await fs.readFile(path.join(userData, 'previews', 'preview-a', 'locked.txt'), 'utf8'), 'lock');
});

test('cleanup IPC validates the sender before scanning or clearing and localizes invalid requests', async t => {
  const { userData, session } = await fixture(t);
  const handlers = new Map();
  let allowed = false;
  const attached = attachCleanup({ userData, session, getLocale: () => 'en',
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
    assertSender: () => { if (!allowed) throw new Error('Unauthorized sender.'); },
  });
  await assert.rejects(handlers.get('bid:cleanup:preview')({}, undefined), /Unauthorized/);
  await assert.rejects(handlers.get('bid:cleanup:run')({}, {}), /Unauthorized/);
  allowed = true;
  await assert.rejects(handlers.get('bid:cleanup:run')({}, { path: '../project' }), /Invalid cleanup request/);
  const preview = await handlers.get('bid:cleanup:preview')({}, undefined);
  assert.equal(preview.categories.length, 2);
  attached.dispose(); assert.equal(handlers.size, 0);
});
