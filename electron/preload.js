'use strict'
/**
 * electron/preload.js — 无边框窗口控制（自定义标题栏按钮调用）
 * contextIsolation 开启，仅暴露最小化/最大化/关闭三个方法
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close')
})
