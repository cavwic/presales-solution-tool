'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
const { createSkillService, attachSkills, parseSkill, LIMITS, CHANNELS } = require('./skills.cjs');

const markdown = (name = 'synthetic-skill', description = 'A synthetic skill for tests only.') => Buffer.from(`---\nname: ${name}\ndescription: ${description}\n---\n\n# Synthetic guidance\nUse only verified project facts.\n`);
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'presales-skills-test-'));
  t.after(async () => {
    const resolved = path.resolve(directory), expected = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(expected) || !path.basename(resolved).startsWith('presales-skills-test-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { directory, service: createSkillService({ userData: directory, ...options }) };
}
async function zip(files, options = {}) {
  const archive = new JSZip();
  for (const [name, value] of Object.entries(files)) archive.file(name, value.data || value, value.options || {});
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', ...options });
}
const publicDns = async () => [{ address: '140.82.112.3', family: 4 }];

test('imports single markdown disabled, persists its source and enables shared prompt context', async t => {
  const { directory, service } = await fixture(t);
  assert.deepEqual(await service.list(), []);
  const imported = await service.importFile({ name: '本次虚构测试.md', data: markdown() });
  assert.equal(imported.name, 'synthetic-skill'); assert.equal(imported.enabled, false);
  assert.equal(imported.source.kind, 'file'); assert.equal(imported.fileCount, 1);
  assert.match(imported.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(await service.context(), '');
  await service.setEnabled({ id: imported.id, enabled: true });
  assert.match(await service.context(), /已启用的工具内 Skills/);
  assert.match(await service.context({ locale: 'en' }), /Project facts, selected sources and task requirements take priority/);
  const restored = createSkillService({ userData: directory });
  assert.equal((await restored.list())[0].enabled, true);
  assert.equal((await restored.read({ id: imported.id })).skillText, markdown().toString());
});

test('retains textual scripts as inactive attachments, includes references and skips binary assets', async t => {
  const { directory, service } = await fixture(t);
  const archive = await zip({ 'package/SKILL.md': markdown(), 'package/references/rules.md': 'REFERENCE_TEXT', 'package/scripts/check.py': 'SCRIPT_MUST_NEVER_EXECUTE', 'package/agents/openai.yaml': 'config: INACTIVE_AGENT', 'package/assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  const imported = await service.importFile({ name: 'fixture.zip', data: archive });
  assert.equal(imported.fileCount, 4); assert.equal(imported.referenceCount, 1); assert.equal(imported.ignoredFileCount, 1);
  assert.equal(imported.executionMode, 'prompt-context');
  assert.deepEqual(imported.limitations, ['scripts-not-executed', 'binary-assets-not-loaded', 'context-size-limited']);
  assert.equal(await fs.readFile(path.join(directory, 'tool-skills', imported.id, 'content', 'scripts', 'check.py'), 'utf8'), 'SCRIPT_MUST_NEVER_EXECUTE');
  await service.setEnabled({ id: imported.id, enabled: true });
  const context = await service.context();
  assert.match(context, /REFERENCE_TEXT/); assert.doesNotMatch(context, /SCRIPT_MUST_NEVER_EXECUTE|INACTIVE_AGENT/);
});

test('rejects a name conflict without changing the existing package or enabled state', async t => {
  const { service } = await fixture(t);
  await service.importFile({ name: 'original.md', data: markdown() });
  await service.setEnabled({ id: 'synthetic-skill', enabled: true });
  await assert.rejects(service.importFile({ name: 'replacement.md', data: markdown('synthetic-skill', 'Changed description') }), { code: 'ALREADY_EXISTS' });
  assert.equal((await service.list())[0].enabled, true);
  assert.equal((await service.read({ id: 'synthetic-skill' })).description, 'A synthetic skill for tests only.');
});

test('supports folded frontmatter descriptions but rejects hooks, invalid names and malformed UTF-8', async t => {
  assert.equal(parseSkill(Buffer.from('---\nname: folded-skill\ndescription: >-\n  First line\n  second line\nmetadata:\n  author: synthetic\n---\nBody')).description, 'First line second line');
  assert.equal(parseSkill(Buffer.from('---\nname: tool-list\ndescription: Test common YAML list\nallowed-tools: [Read, Grep, Glob]\n---\nBody')).name, 'tool-list');
  const { service } = await fixture(t);
  for (const bytes of [markdown('../escape'), markdown('con'), markdown('bad name'), Buffer.from('---\nname: bad\ndescription: test\nhooks: run.exe\n---\nBody'), Buffer.from([0xff, 0xfe, 0x00])]) {
    await assert.rejects(service.importFile({ name: 'bad.md', data: bytes }), error => ['INVALID_SKILL', 'INVALID_FRONTMATTER', 'INVALID_UTF8'].includes(error.code));
  }
  assert.deepEqual(await service.list(), []);
});

test('rejects original ZIP traversal names, Windows aliases, duplicate paths and symlinks', async t => {
  const { service } = await fixture(t);
  for (const name of ['../escape.md', 'C:/escape.md', 'sample/../escape.md', 'sample\\escape.md', 'sample/con.txt', 'sample/trailing.']) {
    const bytes = await zip({ 'sample/SKILL.md': markdown(), [name]: 'BAD' });
    await assert.rejects(service.importFile({ name: 'bad.zip', data: bytes }), error => ['INVALID_PATH', 'INVALID_ARCHIVE'].includes(error.code));
  }
  await assert.rejects(service.importFile({ name: 'duplicate.zip', data: await zip({ 'sample/SKILL.md': markdown(), 'sample/references/A.md': 'one', 'sample/references/a.md': 'two' }) }), { code: 'INVALID_ARCHIVE' });
  const link = await zip({ 'sample/SKILL.md': markdown(), 'sample/link.md': { data: '../outside.md', options: { unixPermissions: 0o120777 } } }, { platform: 'UNIX' });
  await assert.rejects(service.importFile({ name: 'link.zip', data: link }), { code: 'INVALID_ARCHIVE' });
});

test('bounds file count, expanded bytes, text bytes and refuses multiple skills', async t => {
  const { service } = await fixture(t);
  const tooMany = { 'SKILL.md': markdown() };
  for (let index = 0; index < LIMITS.entries; index++) tooMany[`r-${index}.txt`] = 'x';
  await assert.rejects(service.importFile({ name: 'count.zip', data: await zip(tooMany) }), { code: 'LIMIT_EXCEEDED' });
  await assert.rejects(service.importFile({ name: 'bomb.zip', data: await zip({ 'SKILL.md': markdown(), 'huge.txt': Buffer.alloc(LIMITS.fileBytes + 1, 65) }) }), { code: 'LIMIT_EXCEEDED' });
  await assert.rejects(service.importFile({ name: 'large.md', data: Buffer.concat([markdown(), Buffer.alloc(LIMITS.textBytes, 65)]) }), { code: 'LIMIT_EXCEEDED' });
  await assert.rejects(service.importFile({ name: 'multi.zip', data: await zip({ 'a/SKILL.md': markdown('first'), 'b/SKILL.md': markdown('second') }) }), { code: 'INVALID_ARCHIVE' });
});

test('checks CRC and central-directory sizes instead of trusting a damaged ZIP', async t => {
  const { service } = await fixture(t);
  const bytes = await zip({ 'SKILL.md': markdown() }, { compression: 'STORE' });
  const changed = Buffer.from(bytes);
  const body = changed.indexOf(Buffer.from('# Synthetic guidance'));
  assert.ok(body > 0); changed[body] ^= 1;
  await assert.rejects(service.importFile({ name: 'damaged.zip', data: changed }), { code: 'INVALID_ARCHIVE' });
  const oversized = Buffer.from(bytes), central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  oversized.writeUInt32LE(0xffffffff, central + 24);
  await assert.rejects(service.importFile({ name: 'zip64.zip', data: oversized }), { code: 'INVALID_ARCHIVE' });
});

test('refuses storage symlinks and changed content while still permitting safe disable', async t => {
  const { directory, service } = await fixture(t);
  await service.importFile({ name: 'fixture.md', data: markdown() });
  await service.setEnabled({ id: 'synthetic-skill', enabled: true });
  await fs.writeFile(path.join(directory, 'tool-skills', 'synthetic-skill', 'content', 'SKILL.md'), markdown('synthetic-skill', 'Edited outside app'));
  await assert.rejects(service.context(), { code: 'CONTENT_CHANGED' });
  await service.setEnabled({ id: 'synthetic-skill', enabled: false });
  assert.equal(await service.context(), '');
  const second = await fixture(t), target = path.join(second.directory, 'target');
  await fs.mkdir(target);
  await fs.symlink(target, path.join(second.directory, 'tool-skills'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(second.service.list(), { code: 'UNSAFE_STORAGE' });
});

test('bounds shared context across enabled skills without exposing inactive script text', async t => {
  const { service } = await fixture(t);
  for (const name of ['large-one', 'large-two', 'large-three']) {
    await service.importFile({ name: `${name}.md`, data: Buffer.concat([markdown(name), Buffer.alloc(25000, 65)]) });
    await service.setEnabled({ id: name, enabled: true });
  }
  assert.equal((await service.context()).length, LIMITS.maxContextCharacters);
  const context = await service.context();
  assert.equal((context.match(/<imported-skill /g) || []).length, (context.match(/<\/imported-skill>/g) || []).length);
});

test('only accepts allowlisted HTTPS GitHub URLs without credentials, custom ports or local DNS', async t => {
  let calls = 0;
  const { service } = await fixture(t, { fetcher: async () => { calls++; throw new Error('unexpected'); }, resolve: publicDns });
  for (const url of ['http://github.com/a/b/tree/main/skill', 'https://127.0.0.1/skill.zip', 'https://github.com:8443/a/b/tree/main/skill', 'https://user:password@github.com/a/b/tree/main/skill', 'https://github.com.evil.test/a/b/tree/main/skill', 'https://example.com/skill.zip']) {
    await assert.rejects(service.installUrl({ url }), error => ['INVALID_URL', 'NETWORK_BLOCKED'].includes(error.code));
  }
  assert.equal(calls, 0);
  const local = await fixture(t, { fetcher: async () => { calls++; throw new Error('unexpected'); }, resolve: async () => [{ address: '192.168.50.118' }] });
  await assert.rejects(local.service.installUrl({ url: 'https://raw.githubusercontent.com/a/b/main/SKILL.md' }), { code: 'NETWORK_BLOCKED' });
  assert.equal(calls, 0);
});

test('rejects redirects to a local network before requesting the redirect target', async t => {
  const calls = [];
  const { service } = await fixture(t, { resolve: publicDns, fetcher: async url => { calls.push(url); return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }); } });
  await assert.rejects(service.installUrl({ url: 'https://raw.githubusercontent.com/a/b/main/SKILL.md' }), { code: 'NETWORK_BLOCKED' });
  assert.equal(calls.length, 1);
});

test('installs a public raw SKILL.md using bounded anonymous fetch', async t => {
  const requests = [];
  const { service } = await fixture(t, { resolve: publicDns, fetcher: async (url, options) => { requests.push({ url, options }); return new Response(markdown('network-fixture')); } });
  const imported = await service.installUrl({ url: 'https://raw.githubusercontent.com/example/repo/main/SKILL.md' });
  assert.equal(imported.name, 'network-fixture'); assert.equal(imported.source.kind, 'github'); assert.equal(imported.enabled, false);
  assert.equal(requests[0].options.redirect, 'manual'); assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.headers.Authorization, undefined);
});

test('installs one skill ZIP from an allowlisted GitHub redirect without global Codex changes', async t => {
  const archive = await zip({ 'repo-main/one/SKILL.md': markdown('archive-fixture'), 'repo-main/one/references/check.md': 'REFERENCE' });
  const requests = [];
  const { directory, service } = await fixture(t, { resolve: publicDns, fetcher: async url => {
    requests.push(url);
    return url.startsWith('https://github.com/')
      ? new Response(null, { status: 302, headers: { location: 'https://codeload.github.com/example/repo/zip/refs/heads/main' } })
      : new Response(archive);
  } });
  const imported = await service.installUrl({ url: 'https://github.com/example/repo/archive/refs/heads/main.zip' });
  assert.equal(imported.name, 'archive-fixture'); assert.equal(imported.enabled, false);
  assert.equal((await service.read({ id: imported.id })).references[0].text, 'REFERENCE');
  assert.equal(requests.length, 2);
  assert.deepEqual(await fs.readdir(directory), ['tool-skills']);
});

test('installs precisely one GitHub directory at immutable tree/blob revisions', async t => {
  const rootSha = 'a'.repeat(40), directorySha = 'b'.repeat(40), data = markdown('github-directory');
  const blobSha = createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');
  const urls = [];
  const { service } = await fixture(t, { resolve: publicDns, fetcher: async url => {
    urls.push(url);
    if (url.endsWith('/trees/main')) return Response.json({ sha: rootSha, tree: [{ path: 'selected', type: 'tree', mode: '040000', sha: directorySha }] });
    if (url.endsWith(`/trees/${directorySha}`)) return Response.json({ sha: directorySha, tree: [] });
    if (url.endsWith(`/trees/${directorySha}?recursive=1`)) return Response.json({ sha: directorySha, truncated: false, tree: [{ path: 'SKILL.md', type: 'blob', mode: '100644', sha: blobSha, size: data.length }] });
    if (url.endsWith(`/blobs/${blobSha}`)) return Response.json({ encoding: 'base64', content: data.toString('base64') });
    throw new Error('Unexpected URL ' + url);
  } });
  const imported = await service.installUrl({ url: 'https://github.com/example/repo/tree/main/selected' });
  assert.equal(imported.name, 'github-directory'); assert.equal(imported.source.revision, directorySha);
  assert.equal(urls.length, 4); assert.ok(urls.every(url => url.startsWith('https://api.github.com/repos/example/repo/git/')));
});

test('rejects GitHub symlink entries, truncated trees and oversized downloads without writing a skill', async t => {
  for (const tree of [{ truncated: false, tree: [{ path: 'SKILL.md', type: 'blob', mode: '120000', sha: 'c'.repeat(40), size: 10 }] }, { truncated: true, tree: [] }]) {
    const { service } = await fixture(t, { resolve: publicDns, fetcher: async url => Response.json(url.includes('?recursive=1') ? tree : { sha: 'a'.repeat(40), tree: [] }) });
    await assert.rejects(service.installUrl({ url: 'https://github.com/example/repo/tree/main' }), error => ['INVALID_PATH', 'LIMIT_EXCEEDED'].includes(error.code));
    assert.deepEqual(await service.list(), []);
  }
  const oversized = await fixture(t, { resolve: publicDns, fetcher: async () => new Response('small body', { headers: { 'content-length': String(LIMITS.archiveBytes + 1) } }) });
  await assert.rejects(oversized.service.installUrl({ url: 'https://codeload.github.com/example/repo/zip/refs/heads/main' }), { code: 'LIMIT_EXCEEDED' });
});

test('registers all five IPC operations behind sender validation with localized bounded errors', async t => {
  const { service } = await fixture(t), handlers = new Map();
  attachSkills({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, service, assertSender: event => { if (!event.trusted) throw new Error('untrusted'); }, getLocale: () => 'en' });
  assert.deepEqual([...handlers.keys()], CHANNELS);
  const rejected = await handlers.get(CHANNELS[1])({ trusted: false }, { name: 'fake.md', data: markdown() });
  assert.equal(rejected.ok, false); assert.doesNotMatch(rejected.error.message, /untrusted/);
  assert.deepEqual(await service.list(), []);
  const imported = await handlers.get(CHANNELS[1])({ trusted: true }, { name: 'fake.md', data: markdown() });
  assert.equal(imported.ok, true); assert.equal(imported.value.enabled, false);
});
