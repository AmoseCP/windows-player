import { app, shell, BrowserWindow, protocol, net, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'
import { flushSaveSync } from './store'

// localfile:// 协议供渲染进程流式播放本地音频文件（需在 app ready 前注册特权）
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { stream: true, supportFetchAPI: true } }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: '音乐播放器',
    backgroundColor: '#121212',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.musicplayer.app')

  // localfile:///<绝对路径> → 流式读取本地文件（封面图 + 音频播放），转发 Range 头支持进度拖动
  protocol.handle('localfile', async (request) => {
    try {
      const { pathname } = new URL(request.url)
      return await net.fetch('file://' + pathname, {
        headers: request.headers,
        bypassCustomProtocolHandlers: true
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })

  registerIpcHandlers()

  // 系统媒体键（加分项）：注册失败静默降级
  const sendMediaKey = (action: string) => (): void => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('media:key', action))
  }
  try {
    globalShortcut.register('MediaPlayPause', sendMediaKey('play-pause'))
    globalShortcut.register('MediaNextTrack', sendMediaKey('next'))
    globalShortcut.register('MediaPreviousTrack', sendMediaKey('prev'))
  } catch {
    // 忽略：部分系统需要额外权限
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 退出前强制落盘未保存数据
app.on('before-quit', () => {
  flushSaveSync()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
