'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const CATEGORY_IDS = ['runtime-cache', 'previews'];
const CHANNELS = ['bid:cleanup:preview', 'bid:cleanup:run'];
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
const fail = (code, message) => Object.assign(new Error(message), { name: 'NotAllowedError', code });
const messages = {
  INVALID_INPUT: ['清理请求无效，请重新选择。', 'Invalid cleanup request. Select the items again.'],
  EXPIRED_PREVIEW: ['清理预览已失效，请重新扫描。', 'The cleanup preview has expired. Scan again.'],
  UNSAFE_PATH: ['临时文件位置已改变或包含链接，已保留。', 'The temporary file location changed or contains a link. It was kept.'],
  FILE_CHANGED: ['文件在预览后已改变，已保留。', 'The file changed after the preview and was kept.'],
  ENOENT: ['文件已不存在，未执行清理。', 'The file no longer exists. No cleanup was performed.'],
  EACCES: ['无法访问此文件，请检查权限。', 'The file could not be accessed. Check its permissions.'],
  EPERM: ['文件无法清理，可能正在使用。', 'The file could not be cleared. It may be in use.'],
};
function messageFor(error, english) {
  return (messages[error?.code] || ['清理失败，请关闭相关文件后重试。', 'Cleanup failed. Close the affected files and try again.'])[english ? 1 : 0];
}
const identity = info => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');

/** This service only owns HTTP cache and userData/previews. It never clears browser storage. */
function createCleanupService({ userData, session, getLocale = () => 'zh', now = Date.now, io = fs } = {}) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData) || !session?.getCacheSize || !session?.clearCache) {
    throw new TypeError('Cleanup requires an absolute app data path and a session cache API.');
  }
  const storage = path.resolve(userData);
  const previews = path.join(storage, 'previews');
  let snapshot = null;
  let queue = Promise.resolve();
  const serial = action => {
    const pending = queue.then(action, action);
    queue = pending.catch(() => {});
    return pending;
  };
  const english = () => String(getLocale()).toLowerCase().startsWith('en');
  async function checked(parts, file = false) {
    let current = storage;
    const paths = [storage, ...parts.map(part => (current = path.join(current, part)))];
    let info;
    for (const [index, filename] of paths.entries()) {
      info = await io.lstat(filename);
      const last = index === paths.length - 1;
      if (info.isSymbolicLink() || normalized(await io.realpath(filename)) !== normalized(filename)
        || (last && file ? !info.isFile() : !info.isDirectory())) {
        throw fail('UNSAFE_PATH', 'Unsafe cleanup path.');
      }
    }
    return { filename: paths.at(-1), info };
  }
  async function fingerprint(parts) {
    const initial = await checked(parts, true);
    // Previews can be large Office/PDF files. Hash in bounded chunks instead of loading them all.
    const handle = await io.open(initial.filename, 'r');
    const hash = createHash('sha256');
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || identity(opened) !== identity(initial.info)) throw fail('FILE_CHANGED', 'Temporary file changed.');
      const chunk = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        hash.update(chunk.subarray(0, bytesRead));
      }
      if (identity(await handle.stat()) !== identity(initial.info)) throw fail('FILE_CHANGED', 'Temporary file changed.');
    } finally { await handle.close(); }
    const after = await checked(parts, true);
    if (identity(initial.info) !== identity(after.info)) throw fail('FILE_CHANGED', 'Temporary file changed.');
    return { identity: identity(after.info), hash: hash.digest('hex'), bytes: after.info.size };
  }
  async function scan() {
    const files = [];
    try { await checked(['previews']); }
    catch (error) { if (error.code === 'ENOENT') return files; throw error; }
    const visit = async parts => {
      const directory = await checked(parts);
      for (const entry of await io.readdir(directory.filename, { withFileTypes: true })) {
        // A link or special file is never an implicit cleanup grant.
        if (entry.isSymbolicLink() || !entry.name || /[/\\\x00]/.test(entry.name) || ['.', '..'].includes(entry.name)) continue;
        const child = [...parts, entry.name];
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile()) {
          try { files.push({ parts: child, name: child.slice(1).join('/'), ...await fingerprint(child) }); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
    };
    await visit(['previews']);
    return files;
  }
  return {
    preview(input) {
      return serial(async () => {
        if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)) throw fail('INVALID_INPUT', 'Invalid cleanup preview.');
        const bytes = await session.getCacheSize();
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid cache size.');
        const files = await scan();
        snapshot = { token: randomUUID(), created: now(), files };
        return { token: snapshot.token, categories: [
          { id: 'runtime-cache', count: bytes ? 1 : 0, bytes },
          { id: 'previews', count: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), files: files.map(({ name, bytes }) => ({ name, bytes })) },
        ] };
      });
    },
    run(input) {
      return serial(async () => {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['token', 'categories'].includes(key))
          || typeof input.token !== 'string' || !Array.isArray(input.categories) || !input.categories.length || input.categories.length > CATEGORY_IDS.length
          || new Set(input.categories).size !== input.categories.length || input.categories.some(id => !CATEGORY_IDS.includes(id))) throw fail('INVALID_INPUT', 'Invalid cleanup selection.');
        if (!snapshot || input.token !== snapshot.token || now() - snapshot.created > 10 * 60 * 1000) throw fail('EXPIRED_PREVIEW', 'Cleanup preview expired.');
        const selected = snapshot;
        snapshot = null; // A confirmation token cannot be replayed.
        const categories = [], errors = [];
        const report = (name, error) => errors.push({ name, message: messageFor(error, english()) });
        for (const id of input.categories) {
          const result = { id, count: 0, bytes: 0, failed: 0 };
          if (id === 'runtime-cache') {
            try {
              const bytes = await session.getCacheSize();
              await session.clearCache();
              result.count = bytes > 0 ? 1 : 0;
              result.bytes = Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
            } catch (error) { result.failed++; report(id, error); }
          } else {
            for (const file of selected.files) {
              try {
                const current = await fingerprint(file.parts);
                if (current.identity !== file.identity || current.hash !== file.hash) throw fail('FILE_CHANGED', 'Temporary file changed.');
                const verified = await checked(file.parts, true);
                if (identity(verified.info) !== file.identity) throw fail('FILE_CHANGED', 'Temporary file changed.');
                await io.unlink(verified.filename);
                result.count++; result.bytes += file.bytes;
              } catch (error) { result.failed++; report(file.name, error); }
            }
          }
          categories.push(result);
        }
        return { categories, errors };
      });
    },
  };
}

function attachCleanup({ ipcMain, assertSender, ...options } = {}) {
  if (!ipcMain?.handle || typeof assertSender !== 'function') throw new TypeError('Cleanup IPC requires a sender validator.');
  const service = createCleanupService(options);
  for (const channel of CHANNELS) {
    const method = channel.split(':').at(-1);
    ipcMain.handle(channel, async (event, input) => {
      await assertSender(event);
      try { return await service[method](input); }
      catch (error) { throw new Error(messageFor(error, String(options.getLocale?.() || 'zh').toLowerCase().startsWith('en'))); }
    });
  }
  return { service, dispose() { for (const channel of CHANNELS) ipcMain.removeHandler(channel); } };
}

module.exports = { createCleanupService, attachCleanup };
