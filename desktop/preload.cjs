'use strict';
const { contextBridge, ipcRenderer } = require('electron');
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
