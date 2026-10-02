'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  getConfig: call('config:get'),
  setConfig: call('config:set'),
  chooseDir: call('config:chooseDir'),
  openDataDir: call('config:openDir'),
  loadService: call('service:load'),
  saveService: call('service:save'),
  loadDay: call('day:load'),
  dayRevs: call('day:revs'),
  loadMonth: call('month:load'),
  loadRange: call('range:load'),
  loadUsers: call('users:load'),
  saveUsers: call('users:save'),
  exportExcel: call('excel:export'),
  openFile: call('excel:open'),
  pickImport: call('excel:pick'),
  runImport: call('excel:import'),
  print: call('print'),
  checkUpdate: call('update:check'),
  installUpdate: call('update:install'),
  openUpdateDir: call('update:openDir'),
});
