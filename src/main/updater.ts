import { app, ipcMain, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'

/**
 * 在线更新：检查 GitHub Releases，发现新版本自动下载，下载完由用户点击重启安装。
 * 仅安装版（NSIS）支持；便携版与开发模式直接返回提示。
 */
export function registerUpdaterIpc(): void {
  autoUpdater.autoDownload = true
  // 用户下载完但没点「重启安装」就直接退出时，退出过程中静默完成安装
  autoUpdater.autoInstallOnAppQuit = true

  const send = (state: UpdateState): void => {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send('update:state', state)
    })
  }

  autoUpdater.on('checking-for-update', () => send({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ status: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    send({ status: 'progress', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    send({ status: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) =>
    send({ status: 'error', message: String(err?.message ?? err).slice(0, 200) })
  )

  ipcMain.handle('update:check', async (): Promise<{ error?: string }> => {
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      return { error: '便携版不支持自动更新，请从发布页下载新版本' }
    }
    if (!app.isPackaged) return { error: '开发模式不支持在线更新' }
    try {
      await autoUpdater.checkForUpdates()
      return {}
    } catch (err) {
      // error 事件同样会广播；这里兜底返回，避免调用方悬空等待
      return { error: String(err instanceof Error ? err.message : err).slice(0, 200) }
    }
  })

  ipcMain.on('update:install', () => autoUpdater.quitAndInstall())
}
