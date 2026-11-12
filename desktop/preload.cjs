'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// A delegated native menu makes labels, disabled buttons and tooltips copyable
// without changing their left-click behavior or exposing a clipboard API.
document.addEventListener('contextmenu', (event) => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const target = event.target;
  const control = target.closest('input, textarea, select, [contenteditable="true"]');
  const password = control instanceof HTMLInputElement && control.type === 'password';
  const editable = control instanceof HTMLTextAreaElement || (control instanceof HTMLInputElement && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(control.type)) || control?.getAttribute('contenteditable') === 'true';
  const documentSelection = password ? '' : window.getSelection()?.toString() || '';
  const hasInputSelection = !password && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && typeof control.selectionStart === 'number' && control.selectionEnd > control.selectionStart;
  const temporalText = control instanceof HTMLInputElement && ['date', 'datetime-local', 'month', 'week', 'time'].includes(control.type)
    ? control.closest('.localized-temporal-input')?.querySelector(':scope > span')?.innerText || ''
    : '';
  let text = '';
  if (!password && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && editable) text = control.value ? temporalText || control.value : '';
  else if (control instanceof HTMLSelectElement) text = Array.from(control.selectedOptions).map(option => option.text).join('\n');
  else if (documentSelection) text = documentSelection;
  else {
    const readable = target.closest('button, a, label, summary, [role="button"]') || target;
    text = readable.innerText || '';
  }
  const hint = target.closest('[title]')?.getAttribute('title') || '';
  const placeholder = (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && !control.value ? control.placeholder || temporalText : '';
  if (!editable && !text.trim() && !hint.trim()) return;
  event.preventDefault();
  ipcRenderer.invoke('bid:text-menu', {
    text,
    hint,
    placeholder,
    password,
    editable,
    selected: Boolean(hasInputSelection || documentSelection),
    readOnly: Boolean(control?.readOnly || control?.disabled),
  }).catch(() => {});
}, true);

const skillCall = async (channel, input) => {
  const result = await ipcRenderer.invoke(channel, input);
  if (result.ok) return result.value;
  const error = new Error(result.error.message);
  error.code = result.error.code;
  throw error;
};
contextBridge.exposeInMainWorld('bidDesktop', {
  windowControl: (action) => ipcRenderer.invoke('bid:window', action),
  onWindowState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('bid:window-state', handler);
    ipcRenderer.invoke('bid:window', 'state').then(callback);
    return () => ipcRenderer.removeListener('bid:window-state', handler);
  },
  setLocale: (locale) => ipcRenderer.invoke('bid:locale', locale),
  setTheme: (theme) => ipcRenderer.invoke('bid:theme', theme),
  getApiKey: () => ipcRenderer.sendSync('bid:key:get'),
  setApiKey: (value) => ipcRenderer.sendSync('bid:key:set', value),
  getLocalApiKey: () => ipcRenderer.sendSync('bid:local-key:get'),
  setLocalApiKey: (value) => ipcRenderer.sendSync('bid:local-key:set', value),
  getSubscriptionApiKey: () => ipcRenderer.sendSync('bid:subscription-key:get'),
  setSubscriptionApiKey: (value) => ipcRenderer.sendSync('bid:subscription-key:set', value),
  skills: {
    list: () => skillCall('bid:skills:list'),
    importFile: (input) => skillCall('bid:skills:import-file', input),
    installUrl: (input) => skillCall('bid:skills:install-url', input),
    setEnabled: (input) => skillCall('bid:skills:set-enabled', input),
    read: (input) => skillCall('bid:skills:read', input),
  },
  projects: {
    info: () => skillCall('bid:projects:info'),
    prepare: (input) => skillCall('bid:projects:prepare', input),
    commit: (input) => skillCall('bid:projects:commit', input),
    list: () => skillCall('bid:projects:list'),
    get: (input) => skillCall('bid:projects:get', input),
    setSubmitted: (input) => skillCall('bid:projects:setSubmitted', input),
    openFolder: (input) => skillCall('bid:projects:openFolder', input),
  },
  openFile: (input) => ipcRenderer.invoke('bid:open-file', input),
  windowResize: (input) => ipcRenderer.invoke('bid:resize', input),
  cleanup: {
    preview: () => ipcRenderer.invoke('bid:cleanup:preview'),
    run: (input) => ipcRenderer.invoke('bid:cleanup:run', input),
  },
  fs: {
    pick: (input) => ipcRenderer.invoke('bid:fs:pick', input),
    restore: (input) => ipcRenderer.invoke('bid:fs:restore', input),
    persist: (input) => ipcRenderer.invoke('bid:fs:persist', input),
    op: (input) => ipcRenderer.invoke('bid:fs:op', input),
  },
  modelRequest: (input) => ipcRenderer.invoke('bid:model', input),
  modelChat: (input) => ipcRenderer.invoke('bid:model:chat', input),
  modelCatalog: (input) => ipcRenderer.invoke('bid:model:catalog', input),
  localModelCatalog: (input) => ipcRenderer.invoke('bid:model:local-catalog', input),
  modelTest: (input) => ipcRenderer.invoke('bid:model:test', input),
});
