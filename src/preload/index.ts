import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppData, Track, ImportProgress } from '../shared/types'

// 渲染进程可用的白名单 API
const api = {
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
  pickFolder: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFolder'),
  getCoversDir: (): Promise<string> => ipcRenderer.invoke('app:coversDir'),
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
  pickThemeImage: (): Promise<string | null> => ipcRenderer.invoke('theme:pickImage'),
  getLyrics: (path: string): Promise<{ content: string } | null> =>
    ipcRenderer.invoke('lyrics:get', path),
  onMediaKey: (cb: (action: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, action: string): void => cb(action)
    ipcRenderer.on('media:key', listener)
    return () => ipcRenderer.removeListener('media:key', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
