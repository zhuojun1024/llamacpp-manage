'use strict'
/**
 * electron/main.js — Electron 主进程
 *
 * 复用现有 Node 服务（server/index.js），桌面窗口加载其托管的前端：
 *  - 数据目录指向 %APPDATA%/llamacpp-manage（store.js 通过环境变量覆盖）
 *  - 单实例锁：重复双击只聚焦已有窗口
 *  - 退出时按 PID 精确终止管理器启动的全部实例（含失联），再关闭服务
 */
const { app, BrowserWindow, shell, dialog, Menu } = require('electron')
const path = require('path')
const net = require('net')

// 必须在 require 服务模块前设置（store.js 在 require 时读取环境变量）
const userData = app.getPath('userData')
process.env.LLAMA_MANAGE_DATA = path.join(userData, 'data')
process.env.LLAMA_MANAGE_LOGS = path.join(userData, 'logs')
process.env.NO_BROWSER = '1' // 桌面窗口即 UI，不再另开浏览器

// 端口判定逻辑须与 server/index.js 保持一致
const { Store } = require('../server/store')
const PORT = Number(process.env.PORT) || new Store().loadSettings().port || 8787

function portInUse(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.once('error', () => resolve(true))
    srv.listen(port, host, () => srv.close(() => resolve(false)))
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let win = null
  let serverModule = null
  let shuttingDown = false

  Menu.setApplicationMenu(null) // 移除默认菜单栏（文件/编辑/视图...）

  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(async () => {
    try {
      if (await portInUse(PORT)) {
        dialog.showErrorBox(
          '端口被占用',
          `端口 ${PORT} 已被占用：服务可能已在运行（浏览器访问 http://localhost:${PORT}），` +
          '或请关闭占用端口的程序后重试。'
        )
        app.quit()
        return
      }

      // 启动服务（server/index.js 在 require 时即开始监听）
      serverModule = require('../server/index')
      await serverModule.listening

      win = new BrowserWindow({
        width: 1000,
        height: 640,
        minWidth: 1000,
        minHeight: 640,
        title: 'llama.cpp 管理器',
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      })
      await win.loadURL(`http://localhost:${serverModule.getPort()}`)

      // 外部链接交给系统浏览器
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) shell.openExternal(url)
        return { action: 'deny' }
      })
      win.on('closed', () => { win = null })
    } catch (err) {
      dialog.showErrorBox('启动失败', String((err && err.message) || err))
      app.quit()
    }
  })

  // 退出：按 PID 精确终止全部实例（含失联），再关闭服务
  app.on('before-quit', (e) => {
    if (shuttingDown) return
    e.preventDefault()
    shuttingDown = true
    const done = () => app.quit()
    if (serverModule) {
      serverModule.shutdown()
        .catch(err => console.error('[electron] 退出清理失败:', err))
        .finally(done)
    } else {
      done()
    }
  })

  app.on('window-all-closed', () => app.quit())
}
