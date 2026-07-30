// 主进程 / 渲染进程共享的数据结构与 IPC 契约类型

export const SUPPORTED_EXTENSIONS = [
  '.mp3',
  '.flac',
  '.wav',
  '.ogg',
  '.aac',
  '.m4a',
  '.mp4',
  '.wma'
] as const

export interface Track {
  id: string
  path: string
  title: string // 解析失败时 = 文件名（去扩展名）
  artist: string // 缺省 "未知艺术家"
  album: string // 缺省 "未知专辑"
  duration: number // 秒
  coverFile: string | null // userData/covers/ 下的文件名
  addedAt: number
  size?: number // 文件字节数，用于识别被移动/改名的同一文件
  missing?: boolean // 文件不存在则置 true，列表标灰
}

export interface ImportProgress {
  done: number
  total: number
}

export interface PlaylistFolder {
  id: string
  name: string
  playlistIds: string[]
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[] // 数组顺序 = 歌单内手动排序
}

export type PlayMode = 'order' | 'loop' | 'single' | 'shuffle'

export interface AppSettings {
  volume: number
  muted: boolean
  playMode: PlayMode
  lastPlayedTrackId: string | null
  sidebarWidth: number
  sidebarCollapsed?: boolean
  themeImage: string | null // 自定义背景图片的绝对路径（userData/theme 下）
  colorTheme?: string // 配色主题 id（dark/pink/red/blue/purple/orange）
  playbackRate?: number // 播放速度倍率
  fadeSeconds?: number // 淡入淡出时长（秒），0 = 关闭
}

export interface YouTubeSearchResult {
  videoId: string
  title: string
  channel: string
  duration: string // 如 "4:23"，直播为空
  thumbnail: string
}

export interface YouTubeHistoryItem {
  url: string
  videoId: string // 为空表示纯歌单链接
  listId: string | null
  title: string | null // oEmbed 获取，失败时为 null 显示原链接
  playedAt: number
}

/** userData/library.json 的完整结构 */
export interface AppData {
  tracks: Record<string, Track>
  trackOrder: string[]
  folders: PlaylistFolder[]
  playlists: Record<string, Playlist>
  rootPlaylistIds: string[]
  settings: AppSettings
  youtubeHistory?: YouTubeHistoryItem[]
  musicFolders?: string[] // 登记为音乐库来源的根文件夹
  ignoredPaths?: string[] // 手动从库中删除过的文件，重新扫描时不再自动加回
}

/** 重新扫描结果 */
export interface ScanResult {
  added: Track[] // 新发现的曲目
  relocated: { id: string; path: string }[] // 被移动/改名、已重新匹配上的曲目
  missingIds: string[] // 根目录下已找不到的曲目
  scanned: number // 扫描到的音频文件总数
}
