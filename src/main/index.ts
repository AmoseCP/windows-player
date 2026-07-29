import {
  app,
  shell,
  BrowserWindow,
  protocol,
  net,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  nativeImage
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'
import { flushSaveSync } from './store'

// localfile:// 协议供渲染进程流式播放本地音频文件（需在 app ready 前注册特权）
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { stream: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false // 仅托盘「退出」/系统退出时为 true；普通关闭 = 隐藏到托盘

const NORMAL_MIN = { width: 960, height: 640 }
const MINI_SIZE = { width: 340, height: 132 }
let normalBounds: Electron.Rectangle | null = null // 迷你模式前的窗口位置尺寸

function showMainWindow(): void {
  if (!mainWindow) return
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: NORMAL_MIN.width,
    minHeight: NORMAL_MIN.height,
    show: false,
    autoHideMenuBar: true,
    title: '伯特利教会音乐播放器 Bethel Church Audio Player',
    backgroundColor: '#121212',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 关闭按钮 = 隐藏到托盘继续运行；只有托盘「退出」才真正退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('伯特利教会音乐播放器 Bethel Church Audio Player')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示播放器', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

/** 迷你模式：缩小窗口 + 置顶；恢复时还原原始尺寸位置 */
function setMiniMode(mini: boolean): void {
  if (!mainWindow) return
  if (mini) {
    normalBounds = mainWindow.getBounds()
    mainWindow.setMinimumSize(MINI_SIZE.width, MINI_SIZE.height)
    mainWindow.setSize(MINI_SIZE.width, MINI_SIZE.height)
    mainWindow.setAlwaysOnTop(true)
  } else {
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setMinimumSize(NORMAL_MIN.width, NORMAL_MIN.height)
    if (normalBounds) {
      mainWindow.setBounds(normalBounds)
    } else {
      mainWindow.setSize(1200, 760)
    }
  }
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.bethelchurch.audioplayer')

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

  ipcMain.on('window:setMini', (_e, mini: boolean) => setMiniMode(mini))

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
  createTray()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMainWindow()
  })
})

// 退出前强制落盘未保存数据
app.on('before-quit', () => {
  isQuitting = true
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
