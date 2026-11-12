'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const INDEX = '历史项目索引.json';
const CSV = '历史项目索引.csv';
const META = '项目档案.json';
const MAX_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i;
const METHODS = ['info', 'prepare', 'commit', 'list', 'get', 'setSubmitted', 'openFolder'];
const TEST_KEYS = ['PRESALES_SOLUTION_TOOL_TEST_DATA', 'SOLUTION_TOOL_TEST_DATA', 'BID_WORKBENCH_TEST_DATA'];

function problem(code, message) { return Object.assign(new Error(message), { code }); }
function normalize(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function inside(root, target) { const relative = path.relative(normalize(root), normalize(target)); return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); }
function validId(value) { if (typeof value !== 'string' || !ID.test(value)) throw problem('INVALID_PROJECT_ID', '项目标识无效。'); return value; }
function text(value, max = 4096) { if (typeof value !== 'string' || value.length > max || /\0/.test(value)) throw problem('INVALID_METADATA', '项目档案内容无效。'); return value; }
function validFolder(value) {
  if (typeof value !== 'string' || !value || value.length > 180 || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) || value === '.' || value === '..' || RESERVED.test(value)) throw problem('INVALID_METADATA', '项目档案目录名称无效。');
  return value;
}
function timestamp(value) { if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) throw problem('INVALID_METADATA', '项目档案时间无效。'); return value; }
function count(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) throw problem('INVALID_METADATA', '项目档案文件数量无效。'); return value; }
function missing(value) { if (!Array.isArray(value) || value.length > 10000) throw problem('INVALID_METADATA', '项目档案缺失文件记录无效。'); return value.map(item => text(item, 2048)); }
function folderFor(id, name) {
  let stem = name.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 60).replace(/[. ]+$/g, '') || '未命名项目';
  if (RESERVED.test(stem) || stem === '.' || stem === '..') stem = '项目-' + stem;
  return validFolder(stem + '--' + createHash('sha256').update(id).digest('hex').slice(0, 12));
}

function resolveProjectLibraryRoot({ sourceRoot, executablePath = process.execPath, packaged = false, userData, environment = process.env } = {}) {
  if (TEST_KEYS.some(key => Object.prototype.hasOwnProperty.call(environment, key))) {
    if (typeof userData !== 'string' || !path.isAbsolute(userData)) throw problem('INVALID_STORAGE', '测试资料目录无效。');
    return path.join(path.resolve(userData), '项目资料库');
  }
  let toolRoot = sourceRoot;
  if (packaged) {
    const executableDirectory = path.dirname(path.resolve(executablePath));
    toolRoot = path.basename(path.dirname(executableDirectory)).toLowerCase() === 'release' ? path.resolve(executableDirectory, '../..') : executableDirectory;
  }
  if (typeof toolRoot !== 'string' || !path.isAbsolute(toolRoot)) throw problem('INVALID_STORAGE', '工具资料目录无效。');
  return path.join(path.resolve(toolRoot), '项目资料库');
}

function createProjectLibraryService({ rootPath, filesystem, openPath, now = () => new Date().toISOString(), onWarning = () => {} } = {}) {
  if (typeof rootPath !== 'string' || !path.isAbsolute(rootPath)) throw new TypeError('Project library root must be absolute.');
  if (typeof filesystem?.registerManagedDirectory !== 'function') throw new TypeError('Project library requires trusted filesystem registration.');
  rootPath = path.resolve(rootPath);
  const indexPath = path.join(rootPath, INDEX);
  let queue = Promise.resolve();
  const serial = action => { const result = queue.then(action, action); queue = result.catch(() => {}); return result; };
  const warn = (code, detail) => { try { onWarning({ code, detail }); } catch {} };

  async function plainDirectory(directory, create = false) {
    if (create) { try { await fs.mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || normalize(await fs.realpath(directory)) !== normalize(directory)) throw problem('UNSAFE_LIBRARY_PATH', '项目资料库或项目目录包含链接，未进行读写。');
    return directory;
  }
  async function checkedFile(filename) {
    if (!inside(rootPath, filename)) throw problem('UNSAFE_LIBRARY_PATH', '项目资料路径越界。');
    try {
      const info = await fs.lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || normalize(await fs.realpath(filename)) !== normalize(filename)) throw problem('UNSAFE_LIBRARY_PATH', '项目资料文件不可使用链接。');
      return info;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function atomicWrite(filename, content) {
    await plainDirectory(rootPath);
    await plainDirectory(path.dirname(filename));
    const existing = await checkedFile(filename);
    const bytes = Buffer.from(content, 'utf8');
    if (existing && (await fs.readFile(filename)).equals(bytes)) return;
    const temporary = path.join(path.dirname(filename), '.project-library-' + randomUUID() + '.tmp');
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      // Revalidate after the write; no replaced link may become a write target.
      await plainDirectory(rootPath); await plainDirectory(path.dirname(filename)); await checkedFile(filename);
      await fs.rename(temporary, filename);
    } finally {
      // Only an exact nonce-named temporary file in the unchanged owned path
      // may be cleaned up; project files and externally replaced paths stay put.
      try {
        await plainDirectory(rootPath); await plainDirectory(path.dirname(filename));
        if (await checkedFile(temporary)) await fs.unlink(temporary);
      } catch (error) { warn(error.code || 'TEMPORARY_FILE_RETAINED', path.basename(temporary)); }
    }
  }
  async function ensureRoot() {
    const parent = path.dirname(rootPath);
    await plainDirectory(parent);
    await plainDirectory(rootPath, true);
    await fs.access(rootPath, constants.W_OK);
  }
  function entryFrom(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem('INVALID_METADATA', '项目档案无效。');
    const id = validId(value.id), folderName = validFolder(value.folderName);
    return { id, name: text(value.name), folderName, folderPath: path.join(rootPath, folderName), customerAlias: text(value.customerAlias), industry: text(value.industry), owner: text(value.owner), stage: text(value.stage, 64), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt), submittedAt: value.submittedAt === null ? null : timestamp(value.submittedAt), sourceCount: count(value.sourceCount), generatedCount: count(value.generatedCount), missingFiles: missing(value.missingFiles), originLabel: text(value.originLabel, 8192) };
  }
  function stored(entry, committed) { const { folderPath, ...record } = entry; return { ...record, ...(typeof committed === 'boolean' ? { committed } : {}) }; }
  async function readState() {
    const info = await checkedFile(indexPath);
    if (!info) {
      const children = await fs.readdir(rootPath, { withFileTypes: true });
      if (children.some(child => child.isDirectory() || child.isSymbolicLink())) throw problem('LIBRARY_INDEX_MISSING', '资料库索引不存在，但项目目录仍在。请保留这些文件，检查或恢复索引后重试。');
      return { version: 1, projects: [] };
    }
    if (info.size > MAX_INDEX_BYTES) throw problem('LIBRARY_INDEX_INVALID', '项目资料库索引过大，已保留原文件。');
    let state;
    try { state = JSON.parse((await fs.readFile(indexPath, 'utf8')).replace(/^\ufeff/, '')); } catch { throw problem('LIBRARY_INDEX_INVALID', '项目资料库索引损坏，已保留原文件，请恢复索引后重试。'); }
    if (state?.version !== 1 || !Array.isArray(state.projects) || state.projects.length > 10000) throw problem('LIBRARY_INDEX_INVALID', '项目资料库索引格式无效，已保留原文件。');
    return state;
  }
  function records(state) {
    const result = new Map(), folderNames = new Set();
    state.projects.forEach((raw, index) => {
      try {
        const entry = entryFrom(raw);
        if (raw.committed !== undefined && typeof raw.committed !== 'boolean') throw problem('INVALID_METADATA', '项目存档状态无效。');
        if (result.has(entry.id) || folderNames.has(normalize(entry.folderName))) throw problem('DUPLICATE_ENTRY', '项目资料库有重复记录。');
        result.set(entry.id, { index, entry, committed: raw.committed }); folderNames.add(normalize(entry.folderName));
      } catch (error) { warn(error.code || 'INVALID_METADATA', 'index entry ' + index); }
    });
    return result;
  }
  async function checkedProject(entry, allowMissingMetadata = false) {
    await plainDirectory(rootPath);
    const directory = path.join(rootPath, validFolder(entry.folderName));
    if (!inside(rootPath, directory) || normalize(directory) === normalize(rootPath)) throw problem('UNSAFE_LIBRARY_PATH', '项目目录越界。');
    await plainDirectory(directory);
    const metadataPath = path.join(directory, META), metadataInfo = await checkedFile(metadataPath);
    if (!metadataInfo) {
      if (!allowMissingMetadata) throw problem('INVALID_METADATA', '项目档案不存在，已保留原目录。');
    } else {
      if (metadataInfo.size > MAX_INDEX_BYTES) throw problem('INVALID_METADATA', '项目档案过大，已保留原文件。');
      let metadata;
      try { metadata = entryFrom(JSON.parse((await fs.readFile(metadataPath, 'utf8')).replace(/^\ufeff/, ''))); }
      catch { throw problem('INVALID_METADATA', '项目档案损坏，已保留原文件。'); }
      if (metadata.id !== entry.id || metadata.folderName !== entry.folderName) throw problem('INVALID_METADATA', '项目档案与索引标识不一致，已保留原文件。');
    }
    return directory;
  }
  async function assertSnapshot(entry) {
    const directory = await checkedProject(entry);
    let workspace, project;
    try {
      const projects = path.join(directory, 'projects'), projectDirectory = path.join(projects, entry.id);
      await plainDirectory(projects); await plainDirectory(projectDirectory);
      const projectPath = path.join(projectDirectory, 'project.json'), workspacePath = path.join(directory, 'workspace.json');
      const projectInfo = await checkedFile(projectPath), workspaceInfo = await checkedFile(workspacePath);
      if (!projectInfo || !workspaceInfo || projectInfo.size > MAX_SNAPSHOT_BYTES || workspaceInfo.size > MAX_INDEX_BYTES) throw problem('PROJECT_NOT_READY', '项目文件尚未完整保存。');
      project = JSON.parse((await fs.readFile(projectPath, 'utf8')).replace(/^\ufeff/, ''));
      workspace = JSON.parse((await fs.readFile(workspacePath, 'utf8')).replace(/^\ufeff/, ''));
    } catch (error) {
      if (error.code === 'UNSAFE_LIBRARY_PATH') throw error;
      throw problem('PROJECT_NOT_READY', '项目记录尚未完整保存，请保存成功后再载入。');
    }
    if (project?.id !== entry.id || typeof project.schemaVersion !== 'string' || workspace?.activeProjectId !== entry.id || typeof workspace.schemaVersion !== 'string') throw problem('PROJECT_NOT_READY', '项目快照与历史记录不匹配，已保留原文件。');
  }
  async function recordIsReady(record) {
    if (record.committed === false) return false;
    // Legacy records had no flag. Only a matching, readable snapshot qualifies.
    await assertSnapshot(record.entry);
    return true;
  }
  function csvCell(value) { const text = String(value ?? '').replace(/"/g, '""'); return '"' + (/^(?:\s*[=+\-@]|[\t\r])/.test(text) ? "'" : '') + text + '"'; }
  async function writeHumanFiles(state, entries) {
    const rows = [['项目名称', '客户', '投递状态', '投递时间', '更新时间', '资料目录'], ...[...entries.values()].filter(record => record.committed !== false).map(({ entry }) => [entry.name, entry.customerAlias, entry.submittedAt ? '已投递' : '未标记投递', entry.submittedAt || '', entry.updatedAt, entry.folderName])];
    try { await atomicWrite(path.join(rootPath, CSV), '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'); }
    catch (error) { warn(error.code || 'HUMAN_INDEX_WRITE_FAILED', CSV); }
  }
  async function writeEntry(entry, isNew = false, committed = true) {
    const directory = await checkedProject(entry, isNew);
    await atomicWrite(path.join(directory, META), JSON.stringify(stored(entry, committed), null, 2) + '\n');
    const guidance = `项目名称：${entry.name || '未命名项目'}\n项目标识：${entry.id}\n客户：${entry.customerAlias}\n行业：${entry.industry}\n负责人：${entry.owner}\n状态：${committed ? entry.submittedAt ? '已投递' : '未标记投递' : '保存尚未完成'}\n投递时间：${entry.submittedAt || ''}\n更新时间：${entry.updatedAt}\n原位置：${entry.originLabel}\n\n本文件由工具维护。项目资料和生成文件保存在本目录的阶段文件夹及 projects 子目录中。\n目录名在首次保存时建立，后续项目改名以本文件和上级历史项目索引为准。\n`;
    try { await atomicWrite(path.join(directory, '项目说明.txt'), guidance); } catch (error) { warn(error.code || 'PROJECT_NOTE_WRITE_FAILED', entry.id); }
  }
  async function persist(state, entry, existingIndex, committed = existingIndex !== undefined) {
    await writeEntry(entry, existingIndex === undefined, committed);
    if (existingIndex === undefined) state.projects.push(stored(entry, committed)); else state.projects[existingIndex] = stored(entry, committed);
    await atomicWrite(indexPath, JSON.stringify(state, null, 2) + '\n');
    await writeHumanFiles(state, records(state));
    return entry;
  }
  async function initialize() {
    await ensureRoot();
    const state = await readState();
    if (!await checkedFile(indexPath)) await atomicWrite(indexPath, JSON.stringify(state, null, 2) + '\n');
    const note = '项目资料库 / Project library\n\n本目录保存工具维护的历史项目、资料和生成文件。\n请通过工具内的“历史项目”查询或使用历史项目索引.csv手动查找。每个项目的“项目说明.txt”显示最新名称、投递状态及原位置。\n项目目录名包含稳定标识；请勿修改历史项目索引.json或项目档案.json。外部原始文件不会由本资料库自动迁移或删除。\n更新程序时请保留本目录。\n';
    if (!await checkedFile(path.join(rootPath, '资料库说明.txt'))) await atomicWrite(path.join(rootPath, '资料库说明.txt'), note);
    await writeHumanFiles(state, records(state));
    return state;
  }
  const operation = action => serial(async () => action(await initialize()));
  const service = {
    info: () => operation(async () => ({ rootPath })),
    prepare: input => operation(async state => {
      const id = validId(input?.id), name = text(input?.name);
      const existing = records(state).get(id);
      let entry;
      if (existing) { entry = existing.entry; await checkedProject(entry); }
      else {
        const folderName = folderFor(id, name);
        if (state.projects.some(raw => raw?.folderName === folderName)) throw problem('FOLDER_COLLISION', '项目目录已被其他记录使用。');
        const directory = path.join(rootPath, folderName);
        try { await fs.lstat(directory); throw problem('FOLDER_EXISTS', '同名项目目录已存在，已保留，请检查历史项目索引。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await plainDirectory(directory, true);
        const date = now();
        entry = { id, name, folderName, folderPath: directory, customerAlias: '', industry: '', owner: '', stage: 'presales', createdAt: date, updatedAt: date, submittedAt: null, sourceCount: 0, generatedCount: 0, missingFiles: [], originLabel: '' };
        await persist(state, entry);
      }
      const directory = await filesystem.registerManagedDirectory(await checkedProject(entry), rootPath);
      return { entry, directory };
    }),
    commit: input => operation(async state => {
      const existing = records(state).get(validId(input?.id));
      if (!existing) throw problem('PROJECT_NOT_FOUND', '历史项目不存在，请先保存项目。');
      const entry = { ...existing.entry };
      for (const key of ['name', 'customerAlias', 'industry', 'owner']) if (input[key] !== undefined) entry[key] = text(input[key]);
      if (input.stage !== undefined) entry.stage = text(input.stage, 64);
      if (input.updatedAt !== undefined) entry.updatedAt = timestamp(input.updatedAt);
      if (input.sourceCount !== undefined) entry.sourceCount = count(input.sourceCount);
      if (input.generatedCount !== undefined) entry.generatedCount = count(input.generatedCount);
      if (input.missingFiles !== undefined) entry.missingFiles = missing(input.missingFiles);
      if (input.originLabel !== undefined) entry.originLabel = text(input.originLabel, 8192);
      // submittedAt is intentionally not part of ordinary autosave input.
      await assertSnapshot(entry);
      return persist(state, entry, existing.index, true);
    }),
    list: () => operation(async state => {
      const output = [];
      for (const record of records(state).values()) {
        const { entry } = record;
        try {
          if (!await recordIsReady(record)) continue;
          output.push(entry);
        } catch (error) { warn(error.code || 'PROJECT_UNAVAILABLE', entry.id); }
      }
      return output.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
    }),
    get: input => operation(async state => {
      const record = records(state).get(validId(input?.id)), entry = record?.entry;
      if (!entry) throw problem('PROJECT_NOT_FOUND', '历史项目不存在。');
      if (!await recordIsReady(record)) throw problem('PROJECT_NOT_READY', '此项目尚未完成保存。');
      const directory = await filesystem.registerManagedDirectory(await checkedProject(entry), rootPath);
      return { entry, directory };
    }),
    setSubmitted: input => operation(async state => {
      const existing = records(state).get(validId(input?.id));
      if (!existing) throw problem('PROJECT_NOT_FOUND', '历史项目不存在。');
      if (!await recordIsReady(existing)) throw problem('PROJECT_NOT_READY', '此项目尚未完成保存。');
      if (typeof input.submitted !== 'boolean') throw problem('INVALID_METADATA', '投递状态无效。');
      const entry = { ...existing.entry, submittedAt: input.submitted ? existing.entry.submittedAt || now() : null };
      return persist(state, entry, existing.index);
    }),
    openFolder: input => operation(async state => {
      let directory = rootPath;
      if (input?.id !== undefined) {
        const entry = records(state).get(validId(input.id))?.entry;
        if (!entry) throw problem('PROJECT_NOT_FOUND', '历史项目不存在。');
        directory = await checkedProject(entry);
      }
      if (typeof openPath !== 'function') throw problem('OPEN_UNAVAILABLE', '当前环境无法打开文件夹。');
      await plainDirectory(directory);
      const error = await openPath(directory);
      if (error) throw problem('OPEN_FAILED', '无法打开项目文件夹，请检查系统文件管理器。');
    }),
  };
  return service;
}

function errorText(error, english) {
  if (!english) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) return '项目资料库无法写入，请检查工具目录权限。';
    if (error?.code === 'ENOSPC') return '磁盘空间不足，项目资料库未能完成保存。';
    if (error?.code === 'ENOENT') return '项目资料库或项目目录不存在，请检查目录位置。';
    return error?.message || '历史项目操作失败。';
  }
  const messages = {
    INVALID_PROJECT_ID: 'The project ID is invalid.', INVALID_METADATA: 'The project archive metadata is invalid.', INVALID_STORAGE: 'The project library location is invalid.', PROJECT_NOT_READY: 'This project has not finished saving, or its snapshot does not match. Wait for a successful save before loading it.',
    UNSAFE_LIBRARY_PATH: 'The project library path contains a link or has changed. No files were changed.', LIBRARY_INDEX_MISSING: 'The library index is missing, but project folders still exist. Keep the files and restore the index.', LIBRARY_INDEX_INVALID: 'The library index is invalid. The original file was kept. Restore it before retrying.', FOLDER_COLLISION: 'This project folder is already used by another archive.', FOLDER_EXISTS: 'This project folder already exists and was kept. Check the library index.', PROJECT_NOT_FOUND: 'This historical project was not found.', OPEN_UNAVAILABLE: 'Opening folders is unavailable in this environment.', OPEN_FAILED: 'The folder could not be opened. Check your system file manager.',
    ENOENT: 'The project library or project folder no longer exists.', EACCES: 'The project library is not writable. Check the tool folder permissions.', EPERM: 'The project library operation was not permitted. Check the tool folder permissions.', EROFS: 'The project library is on a read-only drive.', ENOSPC: 'There is not enough disk space to save the project library.', EBUSY: 'A project library file is in use. Close it and try again.',
  };
  return messages[error?.code] || 'The historical project operation failed. Check the project library and try again.';
}

function attachProjectLibrary({ ipcMain, service, assertSender, getLocale = () => 'zh' } = {}) {
  if (!ipcMain?.handle || !service || typeof assertSender !== 'function') throw new TypeError('Project library IPC requires a service and sender validation.');
  const channels = METHODS.map(method => 'bid:projects:' + method);
  METHODS.forEach((method, index) => {
    ipcMain.handle(channels[index], async (event, input) => {
      try { await assertSender(event); return { ok: true, value: await service[method](input) }; }
      catch (error) { return { ok: false, error: { name: error?.name || 'Error', code: error?.code || null, message: errorText(error, String(getLocale()).startsWith('en')) } }; }
    });
  });
  return { channels, dispose() { channels.forEach(channel => ipcMain.removeHandler(channel)); } };
}

module.exports = { resolveProjectLibraryRoot, createProjectLibraryService, attachProjectLibrary };
