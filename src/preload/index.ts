import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppData, Track, ImportProgress, YouTubeSearchResult } from '../shared/types'

// 渲染进程可用的白名单 API。
// 注意：不再暴露 @electron-toolkit/preload 的 electronAPI —— 它包含任意 channel 的
// ipcRenderer 与完整 process.env，会让此处的白名单形同虚设。
const api = {
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
  pickFolder: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFolder'),
  getCoversDir: (): Promise<string> => ipcRenderer.invoke('app:coversDir'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('app:platform'),
  revealInFolder: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  gcCovers: (usedFiles: string[]): Promise<number> => ipcRenderer.invoke('covers:gc', usedFiles),
  checkExists: (path: string): Promise<boolean> => ipcRenderer.invoke('track:checkExists', path),
  loadData: (): Promise<AppData | null> => ipcRenderer.invoke('data:load'),
  saveData: (data: AppData): void => ipcRenderer.send('data:save', data),
  importPaths: (paths: string[], existingPaths: string[]): Promise<Track[]> =>
    ipcRenderer.invoke('import:paths', paths, existingPaths),
  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ImportProgress): void => cb(p)
    ipcRenderer.on('import:progress', listener)
    return () => ipcRenderer.removeListener('import:progress', listener)
  },
  // 拖入窗口的 File 对象 → 真实文件系统路径
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  setMiniWindow: (mini: boolean): void => ipcRenderer.send('window:setMini', mini),
  windowControl: (action: 'minimize' | 'toggleMaximize' | 'close'): void =>
    ipcRenderer.send('window:control', action),
  openYouTubeLogin: (): void => ipcRenderer.send('youtube:openLogin'),
  openYouTubeWindow: (url: string): void => ipcRenderer.send('youtube:openWindow', url),
  getYouTubeTitle: (url: string): Promise<string | null> =>
    ipcRenderer.invoke('youtube:title', url),
  searchYouTube: (query: string): Promise<YouTubeSearchResult[]> =>
    ipcRenderer.invoke('youtube:search', query),
  onPlayerStop: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('player:stop', listener)
    return () => ipcRenderer.removeListener('player:stop', listener)
  },
  onMiniHover: (cb: (hovered: boolean) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, hovered: boolean): void => cb(hovered)
    ipcRenderer.on('mini:hover', listener)
    return () => ipcRenderer.removeListener('mini:hover', listener)
  },
  pickThemeImage: (): Promise<string | null> => ipcRenderer.invoke('theme:pickImage'),
  getLyrics: (path: string): Promise<{ content: string } | null> =>
    ipcRenderer.invoke('lyrics:get', path),
  onMediaKey: (cb: (action: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, action: string): void => cb(action)
    ipcRenderer.on('media:key', listener)
    return () => ipcRenderer.removeListener('media:key', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
