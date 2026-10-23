'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const KEYS = new Set(['active-workspace', 'task-output', 'project-output']);
const CHANNELS = ['bid:fs:pick', 'bid:fs:restore', 'bid:fs:persist', 'bid:fs:op'];
const ROOT_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i;

function fail(name, message, code) {
  return Object.assign(new Error(message), { name, ...(code ? { code } : {}) });
}
function normalizeError(error) {
  if (['NotFoundError', 'TypeMismatchError', 'NotAllowedError'].includes(error?.name)) return error;
  if (error?.code === 'ENOENT') return fail('NotFoundError', '文件或文件夹不存在。', error.code);
  if (['ENOTDIR', 'EISDIR'].includes(error?.code)) return fail('TypeMismatchError', '文件与文件夹类型不匹配。', error.code);
  if (['EACCES', 'EPERM', 'ELOOP'].includes(error?.code)) return fail('NotAllowedError', '无法访问此文件或文件夹。', error.code);
  const messages = { ENOTEMPTY: '文件夹内仍有文件，请明确选择连同内容一起删除。', EEXIST: '同名文件或文件夹已存在。',
    ENOSPC: '磁盘空间不足，无法保存文件。', EBUSY: '文件正在使用，请关闭相关程序后重试。',
    ENAMETOOLONG: '文件名称或路径过长，请缩短后重试。' };
  if (error?.code && /^E[A-Z]+$/.test(error.code)) return fail('Error', messages[error.code] || '本地文件操作失败，请检查文件状态后重试。', error.code);
  if (error instanceof SyntaxError) return fail('Error', '目录设置文件格式无效，请检查 authorized-folders.json。', 'INVALID_STATE');
  return error instanceof Error ? error : new Error('本地文件操作失败。');
}
function errorMessage(error, english) {
  if (!english) return error.message || '本地文件操作失败。';
  const messages = {
    ENOENT: 'The file or folder no longer exists.',
    ENOTDIR: 'A file was found where a folder was expected.',
    EISDIR: 'A folder was found where a file was expected.',
    EACCES: 'You do not have permission to access this file or folder.',
    EPERM: 'This file operation is not permitted. Check permissions and try again.',
    ELOOP: 'This path contains a symbolic link that cannot be followed.',
    ENOTEMPTY: 'This folder is not empty. Choose to delete its contents before removing it.',
    EEXIST: 'A file or folder with this name already exists.',
    ENOSPC: 'There is not enough disk space to save the file.',
    EBUSY: 'This file is in use. Close the app using it and try again.',
    ENAMETOOLONG: 'The file name or path is too long. Shorten it and try again.',
    INVALID_NAME: 'This file name is not allowed. Use a valid Windows file name.',
    INVALID_PATH: 'This file path is not allowed.',
    INVALID_KEY: 'This folder setting is not supported.',
    INVALID_DATA: 'File contents must be supplied as binary data.',
    INVALID_FINGERPRINT: 'The file verification data is invalid. Scan the files again.',
    FILE_CHANGED: 'The file changed after the cleanup preview and was kept. Scan the files again.',
    UNSAFE_STORAGE: 'The app data folder or settings file has changed or contains a link.',
    INVALID_STATE: 'The folder settings file is invalid. Check authorized-folders.json.',
    UNKNOWN_ROOT: 'Access to this folder has not been granted. Select it again.',
    TYPE_MISMATCH: 'The file or folder does not match the required type.',
    INVALID_HANDLE: 'This file or folder reference is invalid. Select the folder again.',
    ROOT_CHANGED: 'The selected folder has moved or changed. Select it again.',
    PATH_ESCAPE: 'This operation cannot access or delete symbolic links or junctions.',
    ROOT_PROTECTED: 'The selected root folder cannot be overwritten or deleted.',
    UNSUPPORTED_FILE: 'This folder contains a file type that the app cannot delete.',
    PICKER_UNAVAILABLE: 'Folder selection is not available in this environment.',
    INVALID_SELECTION: 'Select a local folder to grant access.',
    INVALID_OPERATION: 'This file operation is not supported.',
    TRASH_UNAVAILABLE: 'The Recycle Bin is not available. No file was deleted.',
  };
  if (messages[error.code]) return messages[error.code];
  const fallback = {
    NotFoundError: 'The file or folder no longer exists.',
    TypeMismatchError: 'The file or folder does not match the required type.',
    NotAllowedError: 'Access to this file or folder is not allowed.',
  };
  return fallback[error.name] || 'The local file operation failed. Check the file and try again.';
}
function validName(value) {
  if (typeof value !== 'string' || !value || value.length > 255 || /[<>:"/\\|?*\x00-\x1f]/.test(value)
    || value === '.' || value === '..' || /[. ]$/.test(value) || RESERVED.test(value)) {
    throw fail('NotAllowedError', '文件名称无效。', 'INVALID_NAME');
  }
  return value;
}
function relativeParts(value) {
  if (typeof value !== 'string' || value.includes('\\')) throw fail('NotAllowedError', '文件路径无效。', 'INVALID_PATH');
  return value === '' ? [] : value.split('/').map(validName);
}
function normalized(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function contains(root, value) {
  const relative = path.relative(normalized(root), normalized(value));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function keyOf(value) {
  if (!KEYS.has(value)) throw fail('NotAllowedError', '不支持保存此目录设置。', 'INVALID_KEY');
  return value;
}
function bytesOf(value) {
  if (!(value instanceof Uint8Array)) throw fail('TypeMismatchError', '写入内容必须是二进制数据。', 'INVALID_DATA');
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
function validFingerprint(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['size', 'sha256'].includes(key))
    || !Number.isSafeInteger(value.size) || value.size < 0 || typeof value.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(value.sha256)) {
    throw fail('NotAllowedError', '文件校验信息无效，请重新扫描。', 'INVALID_FINGERPRINT');
  }
  return { size: value.size, sha256: value.sha256.toLowerCase() };
}
const identity = info => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');

/** Only chooseDirectory (or explicitly injected test grants) can authorize a root. */
function createFilesystemService({ userData, chooseDirectory, grants, trashItem } = {}) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData)) throw new TypeError('userData must be an absolute path.');
  const stateFile = path.join(userData, 'authorized-folders.json');
  const roots = new Map();
  const saved = Object.create(null);
  let storageRoot;
  let queue = Promise.resolve();
  const serial = operation => {
    const current = queue.then(operation, operation);
    queue = current.catch(() => {});
    return current;
  };

  async function assertStorage() {
    if ((await fs.lstat(storageRoot)).isSymbolicLink()
      || normalized(await fs.realpath(storageRoot)) !== normalized(storageRoot)
      || normalized(await fs.realpath(userData)) !== normalized(storageRoot)) {
      throw fail('NotAllowedError', '工具资料目录已改变。', 'UNSAFE_STORAGE');
    }
  }

  async function privateDirectory(parts = []) {
    await assertStorage();
    let current = storageRoot;
    for (const name of parts) {
      validName(name);
      current = path.join(current, name);
      try { await fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const info = await fs.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink() || !contains(storageRoot, await fs.realpath(current))) {
        throw fail('NotAllowedError', '工具资料目录不可使用链接。', 'UNSAFE_STORAGE');
      }
    }
    return current;
  }

  async function saveState() {
    await assertStorage();
    try {
      if ((await fs.lstat(stateFile)).isSymbolicLink()) throw fail('NotAllowedError', '目录设置文件不可使用链接。', 'UNSAFE_STORAGE');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(storageRoot, '.authorized-folders-' + randomUUID() + '.tmp');
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, roots: Object.fromEntries(roots), handles: saved }, null, 2), { flag: 'wx' });
      await fs.rename(temporary, stateFile);
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }

  const ready = (async () => {
    await fs.mkdir(userData, { recursive: true });
    storageRoot = await fs.realpath(userData);
    try {
      if ((await fs.lstat(stateFile)).isSymbolicLink()) throw fail('NotAllowedError', '目录设置文件不可使用链接。', 'UNSAFE_STORAGE');
      const document = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      if (document.version !== 1 || !document.roots || !document.handles) throw fail('Error', '目录设置格式无效，请检查 authorized-folders.json。', 'INVALID_STATE');
      for (const [id, root] of Object.entries(document.roots)) {
        if (ROOT_ID.test(id) && typeof root === 'string' && path.isAbsolute(root)) roots.set(id, path.resolve(root));
      }
      for (const key of KEYS) if (document.handles[key]) saved[key] = document.handles[key];
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (grants) {
      for (const [id, root] of grants instanceof Map ? grants : Object.entries(grants)) {
        if (!ROOT_ID.test(id) || typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('Invalid test grant.');
        const canonical = await fs.realpath(root);
        if (!(await fs.stat(canonical)).isDirectory()) throw new TypeError('A root grant must be a directory.');
        roots.set(id, canonical);
      }
    }
  })();
  // Initialization errors are surfaced by the first API call, without an unhandled rejection.
  ready.catch(() => {});

  function handleFor(rootId, parts, kind) {
    const root = roots.get(rootId);
    return { rootId, relativePath: parts.join('/'), kind, name: parts.length ? parts.at(-1) : path.basename(root) || path.parse(root).root };
  }

  async function checked(handle, expectedKind) {
    if (!handle || typeof handle !== 'object' || !ROOT_ID.test(handle.rootId || '') || !roots.has(handle.rootId)) {
      throw fail('NotAllowedError', '此目录尚未授权，请重新选择文件夹。', 'UNKNOWN_ROOT');
    }
    const parts = relativeParts(handle.relativePath);
    if (!['file', 'directory'].includes(handle.kind) || (expectedKind && handle.kind !== expectedKind)) {
      throw fail('TypeMismatchError', '文件与文件夹类型不匹配。', 'TYPE_MISMATCH');
    }
    if (parts.length && handle.name !== parts.at(-1)) throw fail('NotAllowedError', '文件标识无效。', 'INVALID_HANDLE');
    const root = roots.get(handle.rootId);
    const canonicalRoot = await fs.realpath(root);
    if (normalized(canonicalRoot) !== normalized(root) || !(await fs.lstat(root)).isDirectory() || (await fs.lstat(root)).isSymbolicLink()) {
      throw fail('NotAllowedError', '已授权目录的位置发生变化，请重新选择。', 'ROOT_CHANGED');
    }
    let filename = root;
    let info = await fs.lstat(filename);
    for (const part of parts) {
      filename = path.join(filename, part);
      info = await fs.lstat(filename);
      if (info.isSymbolicLink() || !contains(root, await fs.realpath(filename))) {
        throw fail('NotAllowedError', '无法通过链接访问授权目录以外的文件。', 'PATH_ESCAPE');
      }
    }
    if ((handle.kind === 'file' && !info.isFile()) || (handle.kind === 'directory' && !info.isDirectory())) {
      throw fail('TypeMismatchError', '文件与文件夹类型不匹配。', 'TYPE_MISMATCH');
    }
    return { filename, root, parts, info, handle: handleFor(handle.rootId, parts, handle.kind) };
  }

  async function child(parentHandle, name, kind, create) {
    validName(name);
    const parent = await checked(parentHandle, 'directory');
    const childHandle = handleFor(parentHandle.rootId, [...parent.parts, name], kind);
    try { return (await checked(childHandle, kind)).handle; }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      await checked(parentHandle, 'directory');
      if (kind === 'directory') {
        try { await fs.mkdir(path.join(parent.filename, name)); } catch (creationError) { if (creationError.code !== 'EEXIST') throw creationError; }
      } else {
        try { const file = await fs.open(path.join(parent.filename, name), 'wx'); await file.close(); }
        catch (creationError) { if (creationError.code !== 'EEXIST') throw creationError; }
      }
      return (await checked(childHandle, kind)).handle;
    }
  }

  async function list(handle) {
    const directory = await checked(handle, 'directory');
    const result = [];
    for (const entry of await fs.readdir(directory.filename, { withFileTypes: true })) {
      validName(entry.name);
      // Links are never granted implicitly by listing a selected directory.
      if (entry.isSymbolicLink()) continue;
      const kind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : null;
      if (!kind) continue;
      const value = handleFor(handle.rootId, [...directory.parts, entry.name], kind);
      result.push([entry.name, (await checked(value, kind)).handle]);
    }
    return result;
  }

  async function write(handle, data) {
    const bytes = bytesOf(data);
    const file = await checked(handle, 'file');
    if (!file.parts.length) throw fail('NotAllowedError', '不能改写授权根目录。', 'ROOT_PROTECTED');
    const original = await fs.readFile((await checked(handle, 'file')).filename);
    // Autosave often submits identical content. Preserve the file and its timestamp.
    if (original.equals(bytes)) return true;
    if (original.length) {
      const backupDirectory = await privateDirectory(['file-backups', handle.rootId, ...file.parts.slice(0, -1)]);
      const backup = path.join(backupDirectory, file.parts.at(-1) + '.' + Date.now() + '-' + randomUUID().slice(0, 8) + '.bak');
      // Retain nonempty original content before replacement. No old backup is removed.
      await fs.writeFile(backup, original, { flag: 'wx' });
    }
    const temporary = path.join(path.dirname(file.filename), '.' + file.parts.at(-1) + '.' + randomUUID() + '.tmp');
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      await checked(handle, 'file');
      await fs.rename(temporary, file.filename);
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return true;
  }

  async function removeChecked(handle, recursive) {
    const target = await checked(handle);
    if (!target.parts.length) throw fail('NotAllowedError', '不能删除授权根目录。', 'ROOT_PROTECTED');
    if (handle.kind === 'file') { await fs.unlink((await checked(handle, 'file')).filename); return; }
    if (recursive) {
      // Preflight the entire subtree, so a link never causes a partial recursive deletion.
      const collect = async current => {
        const directory = await checked(current, 'directory');
        const children = [];
        for (const entry of await fs.readdir(directory.filename, { withFileTypes: true })) {
          validName(entry.name);
          if (entry.isSymbolicLink()) throw fail('NotAllowedError', '删除目录中含有链接，请先手动处理。', 'PATH_ESCAPE');
          const kind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : null;
          if (!kind) throw fail('NotAllowedError', '此目录包含不支持删除的文件。', 'UNSUPPORTED_FILE');
          const next = handleFor(current.rootId, [...directory.parts, entry.name], kind);
          await checked(next, kind);
          children.push({ handle: next, children: kind === 'directory' ? await collect(next) : [] });
        }
        return children;
      };
      const remove = async entries => {
        for (const entry of entries) {
          await remove(entry.children);
          const item = await checked(entry.handle);
          if (entry.handle.kind === 'directory') await fs.rmdir(item.filename); else await fs.unlink(item.filename);
        }
      };
      await remove(await collect(handle));
    }
    await fs.rmdir((await checked(handle, 'directory')).filename);
  }

  async function trashChecked(handle, expected) {
    const initial = await checked(handle, 'file');
    const changed = () => fail('NotAllowedError', '文件在清理预览后已改变，已保留，请重新扫描。', 'FILE_CHANGED');
    if (!initial.parts.length) throw fail('NotAllowedError', '不能删除授权根目录。', 'ROOT_PROTECTED');
    if (typeof trashItem !== 'function') throw fail('NotAllowedError', '当前环境不支持回收站，未删除文件。', 'TRASH_UNAVAILABLE');
    const expectedIdentity = identity(initial.info);
    if (expected) {
      if (initial.info.size !== expected.size) throw changed();
      const opened = await fs.open(initial.filename, 'r');
      const hash = createHash('sha256');
      try {
        const openedInfo = await opened.stat();
        if (!openedInfo.isFile() || identity(openedInfo) !== expectedIdentity) throw changed();
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        for (;;) {
          const { bytesRead } = await opened.read(chunk, 0, chunk.length, null);
          if (!bytesRead) break;
          hash.update(chunk.subarray(0, bytesRead));
        }
        if (identity(await opened.stat()) !== expectedIdentity || hash.digest('hex') !== expected.sha256) throw changed();
      } finally { await opened.close(); }
    }
    const final = await checked(handle, 'file');
    if (identity(final.info) !== expectedIdentity) throw changed();
    await trashItem(final.filename);
    return true;
  }

  const invoke = fn => async input => { try { await ready; return await fn(input || {}); } catch (error) { throw normalizeError(error); } };
  const service = {
    pick: invoke(input => serial(async () => {
      if (typeof chooseDirectory !== 'function') throw fail('NotAllowedError', '当前环境无法选择文件夹。', 'PICKER_UNAVAILABLE');
      const selected = await chooseDirectory({ purpose: input.purpose });
      if (selected == null) return null;
      if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw fail('NotAllowedError', '只能授权明确选择的本地目录。', 'INVALID_SELECTION');
      const canonical = await fs.realpath(selected);
      if (!(await fs.stat(canonical)).isDirectory()) throw fail('TypeMismatchError', '请选择文件夹。', 'TYPE_MISMATCH');
      let id = [...roots].find(([, root]) => normalized(root) === normalized(canonical))?.[0];
      if (!id) { id = randomUUID(); roots.set(id, canonical); }
      await saveState();
      return handleFor(id, [], 'directory');
    })),
    restore: invoke(async ({ key }) => {
      keyOf(key);
      if (!saved[key]) return null;
      try { return (await checked(saved[key], 'directory')).handle; }
      catch (error) {
        const mapped = normalizeError(error);
        if (['NotFoundError', 'NotAllowedError', 'TypeMismatchError'].includes(mapped.name)) return null;
        throw error;
      }
    }),
    persist: invoke(input => serial(async () => {
      const key = keyOf(input.key);
      if (input.handle == null) delete saved[key];
      else saved[key] = (await checked(input.handle, 'directory')).handle;
      await saveState();
      return saved[key] || null;
    })),
    op: invoke(input => {
      const operation = async () => {
        switch (input.op) {
          case 'directory': return child(input.handle, input.name, 'directory', input.create === true);
          case 'file': return child(input.handle, input.name, 'file', input.create === true);
          case 'list': return list(input.handle);
          case 'read': return new Uint8Array(await fs.readFile((await checked(input.handle, 'file')).filename));
          case 'stat': { const file = await checked(input.handle, 'file'); return { lastModified: file.info.mtimeMs, size: file.info.size }; }
          case 'write': return write(input.handle, input.data);
          case 'trashEntry': {
            validName(input.name);
            const expected = validFingerprint(input.expectedFingerprint);
            if (input.recursive !== undefined) throw fail('NotAllowedError', '仅支持将单个文件移至回收站。', 'INVALID_OPERATION');
            const parent = await checked(input.handle, 'directory');
            const target = handleFor(input.handle.rootId, [...parent.parts, input.name], 'file');
            // checked() rejects roots, directories, links and escaped paths before calling the OS.
            return trashChecked(target, expected);
          }
          case 'removeEntry': {
            const parent = await checked(input.handle, 'directory');
            validName(input.name);
            const filename = path.join(parent.filename, input.name);
            const info = await fs.lstat(filename);
            if (info.isSymbolicLink()) throw fail('NotAllowedError', '不能通过此工具删除链接。', 'PATH_ESCAPE');
            await removeChecked(handleFor(input.handle.rootId, [...parent.parts, input.name], info.isDirectory() ? 'directory' : 'file'), input.recursive === true);
            return true;
          }
          case 'same': {
            const first = await checked(input.handle);
            const second = await checked(input.data || input.other);
            return input.handle.kind === (input.data || input.other).kind && normalized(first.filename) === normalized(second.filename);
          }
          default: throw fail('NotAllowedError', '不支持此文件操作。', 'INVALID_OPERATION');
        }
      };
      return ['directory', 'file', 'write', 'removeEntry', 'trashEntry'].includes(input.op) ? serial(operation) : operation();
    }),
  };
  return service;
}

function attachFilesystem({ ipcMain, dialog, getWindow, userData, assertSender, getLocale = () => 'zh', trashItem } = {}) {
  if (!ipcMain?.handle || !dialog?.showOpenDialog || typeof assertSender !== 'function') throw new TypeError('Filesystem IPC requires a sender validator and a directory picker.');
  const isEnglish = () => String(getLocale()).toLowerCase().startsWith('en');
  const titles = {
    zh: { 'active-workspace': '选择投标工作区', 'task-output': '选择任务输出文件夹', 'project-output': '选择项目输出文件夹' },
    en: { 'active-workspace': 'Select bid workspace', 'task-output': 'Select task output folder', 'project-output': 'Select project output folder' },
  };
  const service = createFilesystemService({ userData, trashItem, chooseDirectory: async ({ purpose }) => {
    const english = isEnglish();
    const options = { title: titles[english ? 'en' : 'zh'][purpose] || (english ? 'Select folder' : '选择文件夹'),
      buttonLabel: english ? 'Select folder' : '选择文件夹', properties: ['openDirectory', 'createDirectory'] };
    const window = typeof getWindow === 'function' ? getWindow() : null;
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths?.length ? null : result.filePaths[0];
  } });
  for (const channel of CHANNELS) {
    const method = channel.split(':').at(-1);
    ipcMain.handle(channel, async (event, input) => {
      try {
        await assertSender(event);
        return { ok: true, value: await service[method](input) };
      } catch (error) {
        const mapped = normalizeError(error);
        return { ok: false, error: { name: mapped.name || 'Error', message: errorMessage(mapped, isEnglish()), code: mapped.code || null } };
      }
    });
  }
  return { service, channels: [...CHANNELS], dispose() { for (const channel of CHANNELS) ipcMain.removeHandler(channel); } };
}

module.exports = { createFilesystemService, attachFilesystem };
