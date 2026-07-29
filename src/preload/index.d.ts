import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppData, Track, ImportProgress } from '../shared/types'

interface Api {
  pickFiles(): Promise<string[]>
  pickFolder(): Promise<string[]>
  getCoversDir(): Promise<string>
  getAppVersion(): Promise<string>
  checkExists(path: string): Promise<boolean>
  loadData(): Promise<AppData | null>
  saveData(data: AppData): void
  importPaths(paths: string[], existingPaths: string[]): Promise<Track[]>
  onImportProgress(cb: (p: ImportProgress) => void): () => void
  getPathForFile(file: File): string
  onMediaKey(cb: (action: string) => void): () => void
  setMiniWindow(mini: boolean): void
  windowControl(action: 'minimize' | 'toggleMaximize' | 'close'): void
  openYouTubeLogin(): void
  pickThemeImage(): Promise<string | null>
  getLyrics(path: string): Promise<{ content: string } | null>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
