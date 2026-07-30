import type { AppData, Track, ImportProgress, YouTubeSearchResult } from '../shared/types'

interface Api {
  pickFiles(): Promise<string[]>
  pickFolder(): Promise<string[]>
  getCoversDir(): Promise<string>
  getAppVersion(): Promise<string>
  getPlatform(): Promise<string>
  revealInFolder(path: string): Promise<void>
  gcCovers(usedFiles: string[]): Promise<number>
  checkExists(path: string): Promise<boolean>
  loadData(): Promise<AppData | null>
  saveData(data: AppData): void
  importPaths(paths: string[], existingPaths: string[]): Promise<Track[]>
  onImportProgress(cb: (p: ImportProgress) => void): () => void
  getPathForFile(file: File): string
  setMiniWindow(mini: boolean): void
  windowControl(action: 'minimize' | 'toggleMaximize' | 'close'): void
  openYouTubeLogin(): void
  openYouTubeWindow(url: string): void
  getYouTubeTitle(url: string): Promise<string | null>
  searchYouTube(query: string): Promise<YouTubeSearchResult[]>
  onPlayerStop(cb: () => void): () => void
  onMiniHover(cb: (hovered: boolean) => void): () => void
  exportPlaylist(
    name: string,
    entries: { path: string; title: string; duration: number }[]
  ): Promise<boolean>
  importPlaylist(): Promise<{ name: string; paths: string[] } | null>
  readPlaylist(file: string): Promise<{ name: string; paths: string[] } | null>
  importFromUrl(url: string): Promise<Track | { error: string }>
  pickThemeImage(): Promise<string | null>
  getLyrics(path: string): Promise<{ content: string } | null>
  onOpenFiles(cb: (files: string[]) => void): () => void
  onMediaKey(cb: (action: string) => void): () => void
}

declare global {
  interface Window {
    api: Api
  }
}
