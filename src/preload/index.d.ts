import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppData, Track, ImportProgress, YouTubeSearchResult } from '../shared/types'

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
  openYouTubeWindow(url: string): void
  getYouTubeTitle(url: string): Promise<string | null>
  searchYouTube(query: string): Promise<YouTubeSearchResult[]>
  onPlayerStop(cb: () => void): () => void
  onMiniHover(cb: (hovered: boolean) => void): () => void
  pickThemeImage(): Promise<string | null>
  getLyrics(path: string): Promise<{ content: string } | null>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
