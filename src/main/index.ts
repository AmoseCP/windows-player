import {
  app,
  shell,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  screen,
  session
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'
import { flushSaveSync, hasPendingSave } from './store'
import { registerLocalFileSchemes, registerLocalFileProtocol } from './localfile'

// localfile:// 协议供渲染进程流式播放本地音频文件（需在 app ready 前注册特权）
registerLocalFileSchemes()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let loginWindow: BrowserWindow | null = null
let isQuitting = false // 仅托盘「退出」/系统退出时为 true；普通关闭 = 隐藏到托盘

// 兜底日志：主进程未捕获异常不静默消失，便于定位线上问题
process.on('uncaughtException', (err) => console.error('主进程未捕获异常:', err))
process.on('unhandledRejection', (reason) => console.error('主进程未处理的 rejection:', reason))

// YouTube 相关内容（webview 标签、登录窗口、独立播放窗口）统一使用此分区：
// 与主窗口的 defaultSession 隔离（localfile 协议读不到），彼此之间共享登录 cookie
const YOUTUBE_PARTITION = 'persist:youtube'

/** 只允许 http(s) 交给系统打开，避免 file://、ms-msdt: 等被 shell 执行 */
function openExternalSafely(url: string): void {
  try {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url)
  } catch {
    // 非法 URL，忽略
  }
}

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|music)\./, '')
    return (
      host === 'youtube.com' ||
      host === 'youtu.be' ||
      host === 'google.com' ||
      host === 'accounts.google.com'
    )
  } catch {
    return false
  }
}

/** YouTube 系窗口的统一加固：限制站内导航、弹窗交给系统浏览器 */
function hardenYouTubeWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler((details) => {
    // 登录流程需要弹窗，放行 Google/YouTube 域，其余交给系统浏览器
    if (isYouTubeUrl(details.url)) return { action: 'allow' }
    openExternalSafely(details.url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isYouTubeUrl(url)) {
      e.preventDefault()
      openExternalSafely(url)
    }
  })
}

const NORMAL_MIN = { width: 960, height: 640 }
const MINI_SIZE = { width: 240, height: 56 }
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
    // Windows 上无边框 + 渲染进程自绘标题栏（迷你模式无系统装饰）；macOS 保留原生栏便于开发
    frame: process.platform === 'darwin',
    title: '伯特利教会音乐播放器 Bethel Church Audio Player',
    backgroundColor: '#121212',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 在线播放用 <webview> 加载完整版 YouTube 观看页（不受嵌入限制）
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 关闭按钮 = 停止播放并隐藏到托盘；只有托盘「退出」才真正退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      mainWindow?.webContents.send('player:stop')
    }
  })

  mainWindow.on('closed', () => {
    stopMiniHoverWatch()
    mainWindow = null
  })

  // 隐藏到托盘后无需再轮询光标位置
  mainWindow.on('hide', () => stopMiniHoverWatch())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalSafely(details.url)
    return { action: 'deny' }
  })

  // 强制 webview 使用隔离分区且禁用 Node/preload：localfile 协议只注册在
  // defaultSession，隔离后远程页面无法通过该协议读取本地文件
  mainWindow.webContents.on('will-attach-webview', (_e, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    params.partition = YOUTUBE_PARTITION
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

// 迷你条整体是 -webkit-app-region: drag，拖动区域收不到 DOM 鼠标事件（hover 失效），
// 由主进程轮询光标是否位于窗口内，通知渲染层显示/隐藏悬停按钮
let miniHoverTimer: NodeJS.Timeout | null = null
let miniHovered = false

function stopMiniHoverWatch(): void {
  if (miniHoverTimer) {
    clearInterval(miniHoverTimer)
    miniHoverTimer = null
  }
  miniHovered = false
}

function startMiniHoverWatch(): void {
  stopMiniHoverWatch()
  miniHoverTimer = setInterval(() => {
    if (!mainWindow) {
      stopMiniHoverWatch()
      return
    }
    const p = screen.getCursorScreenPoint()
    const b = mainWindow.getBounds()
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
    if (inside !== miniHovered) {
      miniHovered = inside
      mainWindow.webContents.send('mini:hover', inside)
    }
  }, 150)
}

/** 迷你模式：缩小窗口 + 置顶 + 禁止缩放；恢复时还原原始尺寸位置 */
function setMiniMode(mini: boolean): void {
  if (!mainWindow) return
  if (mini) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    normalBounds = mainWindow.getBounds()
    mainWindow.setMinimumSize(MINI_SIZE.width, MINI_SIZE.height)
    mainWindow.setSize(MINI_SIZE.width, MINI_SIZE.height)
    mainWindow.setResizable(false)
    mainWindow.setAlwaysOnTop(true)
    startMiniHoverWatch()
  } else {
    stopMiniHoverWatch()
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setResizable(true)
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

  // macOS 开发模式下 Dock 显示的是 Electron 默认图标，主动换成应用 logo
  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(icon))
  }

  // 只在主窗口所用的 defaultSession 注册，YouTube 分区无法访问本地文件
  registerLocalFileProtocol()

  const youtubeSession = session.fromPartition(YOUTUBE_PARTITION)

  // 打包后页面为 file:// 加载，请求不带 Referer，YouTube 嵌入播放器会报
  // Error 153（强制要求有效 Referer）；给嵌入端点补上
  youtubeSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube.com/embed/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://www.youtube.com/'
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  // 默认拒绝所有权限请求（通知/摄像头/麦克风/定位等）。Electron 默认是放行，
  // webview 里的远程页面可静默取得权限
  for (const s of [session.defaultSession, youtubeSession]) {
    s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    s.setPermissionCheckHandler(() => false)
  }

  registerIpcHandlers()

  ipcMain.on('window:setMini', (_e, mini: boolean) => setMiniMode(mini))

  // YouTube 登录窗口：与在线播放共用 YouTube 分区，登录一次全部生效（Premium 免广告）
  ipcMain.on('youtube:openLogin', () => {
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.focus() // 单例，避免连点开出多个渲染进程
      return
    }
    loginWindow = new BrowserWindow({
      width: 520,
      height: 720,
      autoHideMenuBar: true,
      title: '登录 YouTube',
      webPreferences: { partition: YOUTUBE_PARTITION, sandbox: true, contextIsolation: true }
    })
    hardenYouTubeWindow(loginWindow)
    loginWindow.on('closed', () => {
      loginWindow = null
    })
    void loginWindow.loadURL('https://www.youtube.com')
  })

  // 完整站点播放窗口：版权方禁止嵌入的视频、电台混播（list=RD*）都能播
  ipcMain.on('youtube:openWindow', (_e, url: string) => {
    if (typeof url !== 'string' || !isYouTubeUrl(url)) return
    const win = new BrowserWindow({
      width: 1080,
      height: 720,
      autoHideMenuBar: true,
      title: 'YouTube 播放',
      webPreferences: { partition: YOUTUBE_PARTITION, sandbox: true, contextIsolation: true }
    })
    hardenYouTubeWindow(win)
    void win.loadURL(url)
  })

  // 自绘标题栏的窗口控制（close 走 close 事件 → 隐藏到托盘）
  ipcMain.on('window:control', (_e, action: string) => {
    if (!mainWindow) return
    if (action === 'minimize') mainWindow.minimize()
    else if (action === 'toggleMaximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    } else if (action === 'close') mainWindow.close()
  })

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

// 退出前强制落盘未保存数据；若仍有异步写入在飞，稍等一轮再退出
let quitDeferred = false
app.on('before-quit', (e) => {
  isQuitting = true
  flushSaveSync()
  if (hasPendingSave() && !quitDeferred) {
    quitDeferred = true
    e.preventDefault()
    setTimeout(() => app.quit(), 300)
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
