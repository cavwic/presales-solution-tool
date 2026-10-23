'use strict';
const { app, BrowserWindow, Menu, protocol, dialog, ipcMain, nativeTheme, shell, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { attachFilesystem } = require('./filesystem.cjs');
const { attachCleanup } = require('./cleanup.cjs');
const { createSkillService, attachSkills } = require('./skills.cjs');
const { requestModel } = require('./model.cjs');
const { createModelService } = require('./model-service.cjs');
const { attachWindowControls } = require('./window-controls.cjs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
// Keep the existing origin and profile so renamed releases retain saved projects and settings.
const APP_URL = 'bid://app/cavwic-solutions-lab/';
const isLocal = (value) => { try { const u = new URL(value); return u.protocol === 'bid:' && u.hostname === 'app' && u.pathname.startsWith('/cavwic-solutions-lab/'); } catch { return false; } };
const isSafeExternal = (value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const userData = process.env.PRESALES_SOLUTION_TOOL_TEST_DATA || process.env.SOLUTION_TOOL_TEST_DATA || process.env.BID_WORKBENCH_TEST_DATA || path.join(app.getPath('appData'), 'CavwicBidWorkbench');
app.setName('售前解决方案工具');
app.setPath('userData', userData);
app.setAppUserModelId('Cavwic.PresalesSolutionTool');
protocol.registerSchemesAsPrivileged([{ scheme: 'bid', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let window, controls, locale = 'zh', sessionApiKey = '', sessionLocalApiKey = '', sessionSubscriptionApiKey = '';
const skillService = createSkillService({ userData });
const modelService = createModelService({ userData, buildSkillContext: () => skillService.context({ locale }) });
const pageBackground = () => nativeTheme.shouldUseDarkColors ? '#111b26' : '#eef3f8';
nativeTheme.on('updated', () => { if (window && !window.isDestroyed()) window.setBackgroundColor(pageBackground()); });
let windowState = {};
fs.mkdirSync(userData, { recursive: true });
try { windowState = JSON.parse(fs.readFileSync(path.join(userData, 'window.json'), 'utf8')); } catch {}

function assertSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isLocal(event.senderFrame.url)) throw new Error('请求来源无效 / Untrusted request');
}

function logError(error) {
  fs.appendFileSync(path.join(userData, 'desktop-error.log'), `${new Date().toISOString()} ${String(error?.message || error)}\n`);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.zip': 'application/zip', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };

async function serve(request) {
  if (!isLocal(request.url) || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
  try {
    const relative = decodeURIComponent(new URL(request.url).pathname).slice('/cavwic-solutions-lab/'.length);
    let target = path.resolve(DIST, relative);
    if (target !== DIST && !target.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    const real = fs.realpathSync(target);
    if (!real.startsWith(fs.realpathSync(DIST) + path.sep)) return new Response('Forbidden', { status: 403 });
    const content = fs.readFileSync(real);
    const headers = { 'Content-Type': MIME[path.extname(real)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
    if (real.endsWith('.html')) {
      const hashes = [...content.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter((match) => match[1]).map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
      headers['Content-Security-Policy'] = `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'`;
    }
    return new Response(request.method === 'HEAD' ? null : content, { headers });
  } catch { return new Response('Not found', { status: 404 }); }
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(windowState.width || 1480, area.width), height = Math.min(windowState.height || 960, area.height);
  window = new BrowserWindow({
    width, height, minWidth: 760, minHeight: 540, title: '售前解决方案工具',
    frame: false, thickFrame: false, roundedCorners: false, show: false,
    backgroundColor: pageBackground(),
    icon: path.join(ROOT, 'assets', 'presales-solution-tool.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  controls = attachWindowControls({ window, notify: (state) => window.webContents.send('bid:window-state', state) });
  window.removeMenu();
  window.webContents.on('page-title-updated', (event) => { event.preventDefault(); window.setTitle(locale === 'zh' ? '售前解决方案工具' : 'Presales Solution Tool'); });
  window.webContents.on('will-navigate', (event, url) => { if (!isLocal(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!isLocal(url)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url).catch(logError);
    else if (url.startsWith('blob:bid://app/')) {
      // Download to a user-selected path so previews also open in the user's preferred application.
      window.webContents.downloadURL(url);
    }
    return { action: 'deny' };
  });
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: locale === 'zh' ? '保存文件' : 'Save file', defaultPath: item.getFilename() });
  });
  window.once('ready-to-show', () => { if (windowState.maximized) window.maximize(); window.show(); });
  window.on('close', () => {
    const bounds = window.getNormalBounds();
    try { fs.writeFileSync(path.join(userData, 'window.json'), JSON.stringify({ width: bounds.width, height: bounds.height, maximized: window.isMaximized() })); } catch {}
  });
  window.webContents.on('render-process-gone', (_event, details) => logError(`Renderer stopped: ${details.reason}`));
  window.loadURL(APP_URL).catch(logError);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('bid', serve);
    createWindow();
    attachFilesystem({ ipcMain, dialog, getWindow: () => window, userData, assertSender, getLocale: () => locale, trashItem: filename => shell.trashItem(filename) });
    attachCleanup({ ipcMain, userData, session: window.webContents.session, assertSender, getLocale: () => locale });
    attachSkills({ ipcMain, service: skillService, assertSender, getLocale: () => locale });
    ipcMain.on('bid:key:get', (event) => { try { assertSender(event); event.returnValue = sessionApiKey; } catch { event.returnValue = ''; } });
    ipcMain.on('bid:key:set', (event, value) => { try { assertSender(event); sessionApiKey = typeof value === 'string' && value.length < 16384 ? value.trim() : ''; event.returnValue = true; } catch { event.returnValue = false; } });
    ipcMain.on('bid:local-key:get', (event) => { try { assertSender(event); event.returnValue = sessionLocalApiKey; } catch { event.returnValue = ''; } });
    ipcMain.on('bid:local-key:set', (event, value) => { try { assertSender(event); sessionLocalApiKey = typeof value === 'string' && value.length < 16384 && !/[\r\n]/.test(value) ? value.trim() : ''; event.returnValue = true; } catch { event.returnValue = false; } });
    ipcMain.handle('bid:window', (event, action) => { assertSender(event); return action === 'state' ? controls.state() : controls.action({ action: action === 'maximize' ? 'toggle-maximize' : action }); });
    ipcMain.handle('bid:resize', (event, input) => { assertSender(event); return controls.resize(input); });
    ipcMain.handle('bid:locale', (event, next) => { assertSender(event); locale = next === 'en' ? 'en' : 'zh'; window.setTitle(locale === 'zh' ? '售前解决方案工具' : 'Presales Solution Tool'); });
    ipcMain.handle('bid:theme', (event, theme) => { assertSender(event); if (['light', 'dark', 'system'].includes(theme)) { nativeTheme.themeSource = theme; window.setBackgroundColor(pageBackground()); } });
    ipcMain.handle('bid:model', (event, input) => { assertSender(event); return requestModel(input); });
    ipcMain.on('bid:subscription-key:get', (event) => { try { assertSender(event); event.returnValue = sessionSubscriptionApiKey; } catch { event.returnValue = ''; } });
    ipcMain.on('bid:subscription-key:set', (event, value) => { try { assertSender(event); sessionSubscriptionApiKey = typeof value === 'string' && value.length < 16384 ? value.trim() : ''; event.returnValue = true; } catch { event.returnValue = false; } });
    const withLocalKey = (input) => ({ ...input, localApiKey: input?.localApiKey === undefined ? sessionLocalApiKey : input.localApiKey, subscriptionApiKey: input?.subscriptionApiKey === undefined ? sessionSubscriptionApiKey : input.subscriptionApiKey });
    ipcMain.handle('bid:model:chat', (event, input) => { assertSender(event); return modelService.chat(withLocalKey(input)); });
    ipcMain.handle('bid:model:catalog', (event, input) => { assertSender(event); return modelService.catalog(withLocalKey(input)); });
    ipcMain.handle('bid:model:local-catalog', (event, input) => { assertSender(event); return modelService.localCatalog(withLocalKey(input)); });
    ipcMain.handle('bid:model:test', (event, input) => { assertSender(event); return modelService.test(withLocalKey(input)); });
    ipcMain.handle('bid:open-file', async (event, input) => {
      assertSender(event);
      const name = input?.name;
      if (typeof name !== 'string' || path.basename(name) !== name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || !/\.(pdf|png|jpe?g|webp|gif|txt|md|csv|docx|xlsx|pptx)$/i.test(name)) throw new Error(locale === 'zh' ? '此文件类型暂不支持直接打开' : 'This file type cannot be opened directly');
      if (!(input.data instanceof Uint8Array) || input.data.byteLength > 256 * 1024 * 1024) throw new Error(locale === 'zh' ? '文件内容无效或过大' : 'Invalid file data or file too large');
      const targetDirectory = path.join(userData, 'previews', randomUUID());
      fs.mkdirSync(targetDirectory, { recursive: true });
      const target = path.join(targetDirectory, name);
      fs.writeFileSync(target, input.data, { flag: 'wx' });
      const error = await shell.openPath(target);
      if (error) throw new Error(locale === 'zh' ? '无法打开文件，请检查默认应用' : 'Could not open the file. Check its default application');
      return target;
    });
  }).catch((error) => { logError(error); dialog.showErrorBox('售前解决方案工具', '启动失败，请检查应用文件是否完整。\n' + error.message); app.quit(); });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { sessionApiKey = ''; sessionLocalApiKey = ''; sessionSubscriptionApiKey = ''; modelService.close(); });
