import { create } from 'zustand'
import type {
  Track,
  ImportProgress,
  Playlist,
  PlaylistFolder,
  YouTubeHistoryItem
} from '../../../shared/types'

function ytKey(videoId: string, listId: string | null): string {
  return `${videoId}|${listId ?? ''}`
}

/** 当前主区视图：'library' = 音乐库，否则为歌单 id */
export type View = 'library' | string

interface LibraryState {
  tracks: Record<string, Track>
  trackOrder: string[] // 音乐库导入顺序
  folders: PlaylistFolder[]
  playlists: Record<string, Playlist>
  rootPlaylistIds: string[]
  view: View
  expandedFolders: Record<string, boolean>
  coversDir: string
  importProgress: ImportProgress | null
  sidebarWidth: number
  search: string
  themeImage: string | null
  themeVersion: number // 同名文件被替换时用于刷新缓存
  youtubeHistory: YouTubeHistoryItem[] // 在线播放记录，新的在前

  init: () => Promise<void>
  setSidebarWidth: (w: number) => void
  setSearch: (s: string) => void
  setThemeImage: (path: string | null) => void
  addYouTubeHistory: (item: Omit<YouTubeHistoryItem, 'playedAt'>) => void
  setYouTubeTitle: (videoId: string, listId: string | null, title: string) => void
  removeYouTubeHistory: (videoId: string, listId: string | null) => void
  importPaths: (paths: string[]) => Promise<void>
  markMissing: (id: string) => void

  setView: (view: View) => void
  toggleFolder: (id: string) => void
  createPlaylist: (folderId: string | null) => string
  createFolder: () => string
  renamePlaylist: (id: string, name: string) => void
  renameFolder: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  deleteFolder: (id: string) => void

  addTrackToPlaylist: (playlistId: string, trackId: string) => boolean
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void
  deleteTrackFromLibrary: (trackId: string) => void
  reorderPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => void
  movePlaylist: (playlistId: string, folderId: string | null) => void
}

/** "新建歌单" → "新建歌单 2" → …，避免重名 */
function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export const useLibrary = create<LibraryState>((set, get) => ({
  tracks: {},
  trackOrder: [],
  folders: [],
  playlists: {},
  rootPlaylistIds: [],
  view: 'library',
  expandedFolders: {},
  coversDir: '',
  importProgress: null,
  sidebarWidth: 220,
  search: '',
  themeImage: null,
  themeVersion: 0,
  youtubeHistory: [],

  init: async () => {
    set({ coversDir: await window.api.getCoversDir() })
  },

  setSidebarWidth: (w) => set({ sidebarWidth: w }),

  setSearch: (search) => set({ search }),

  setThemeImage: (themeImage) => set((s) => ({ themeImage, themeVersion: s.themeVersion + 1 })),

  // 同一视频/歌单重复播放时移到最前并更新时间，最多保留 100 条
  addYouTubeHistory: (item) =>
    set((s) => {
      const key = ytKey(item.videoId, item.listId)
      const rest = s.youtubeHistory.filter((h) => ytKey(h.videoId, h.listId) !== key)
      const old = s.youtubeHistory.find((h) => ytKey(h.videoId, h.listId) === key)
      return {
        youtubeHistory: [
          { ...item, title: item.title ?? old?.title ?? null, playedAt: Date.now() },
          ...rest
        ].slice(0, 100)
      }
    }),

  setYouTubeTitle: (videoId, listId, title) =>
    set((s) => ({
      youtubeHistory: s.youtubeHistory.map((h) =>
        ytKey(h.videoId, h.listId) === ytKey(videoId, listId) ? { ...h, title } : h
      )
    })),

  removeYouTubeHistory: (videoId, listId) =>
    set((s) => ({
      youtubeHistory: s.youtubeHistory.filter(
        (h) => ytKey(h.videoId, h.listId) !== ytKey(videoId, listId)
      )
    })),

  importPaths: async (paths) => {
    if (paths.length === 0 || get().importProgress) return
    set({ importProgress: { done: 0, total: 0 } }) // total=0 表示扫描中
    const offProgress = window.api.onImportProgress((p) => set({ importProgress: p }))
    try {
      const existingPaths = Object.values(get().tracks).map((t) => t.path)
      const added = await window.api.importPaths(paths, existingPaths)
      set((s) => {
        const tracks = { ...s.tracks }
        const trackOrder = [...s.trackOrder]
        for (const t of added) {
          tracks[t.id] = t
          trackOrder.push(t.id)
        }
        return { tracks, trackOrder }
      })
    } finally {
      offProgress()
      set({ importProgress: null })
    }
  },

  markMissing: (id) =>
    set((s) => {
      const track = s.tracks[id]
      if (!track || track.missing) return s
      return { tracks: { ...s.tracks, [id]: { ...track, missing: true } } }
    }),

  setView: (view) => set({ view }),

  toggleFolder: (id) =>
    set((s) => ({ expandedFolders: { ...s.expandedFolders, [id]: !s.expandedFolders[id] } })),

  createPlaylist: (folderId) => {
    const id = crypto.randomUUID()
    set((s) => {
      const name = uniqueName(
        '新建歌单',
        Object.values(s.playlists).map((p) => p.name)
      )
      const playlists = { ...s.playlists, [id]: { id, name, trackIds: [] } }
      if (folderId) {
        return {
          playlists,
          folders: s.folders.map((f) =>
            f.id === folderId ? { ...f, playlistIds: [...f.playlistIds, id] } : f
          ),
          expandedFolders: { ...s.expandedFolders, [folderId]: true }
        }
      }
      return { playlists, rootPlaylistIds: [...s.rootPlaylistIds, id] }
    })
    return id
  },

  createFolder: () => {
    const id = crypto.randomUUID()
    set((s) => {
      const name = uniqueName(
        '新建文件夹',
        s.folders.map((f) => f.name)
      )
      return {
        folders: [...s.folders, { id, name, playlistIds: [] }],
        expandedFolders: { ...s.expandedFolders, [id]: true }
      }
    })
    return id
  },

  renamePlaylist: (id, name) =>
    set((s) => {
      const p = s.playlists[id]
      if (!p || !name.trim()) return s
      return { playlists: { ...s.playlists, [id]: { ...p, name: name.trim() } } }
    }),

  renameFolder: (id, name) =>
    set((s) => {
      if (!name.trim()) return s
      return { folders: s.folders.map((f) => (f.id === id ? { ...f, name: name.trim() } : f)) }
    }),

  deletePlaylist: (id) =>
    set((s) => {
      const playlists = { ...s.playlists }
      delete playlists[id]
      return {
        playlists,
        rootPlaylistIds: s.rootPlaylistIds.filter((pid) => pid !== id),
        folders: s.folders.map((f) =>
          f.playlistIds.includes(id)
            ? { ...f, playlistIds: f.playlistIds.filter((pid) => pid !== id) }
            : f
        ),
        view: s.view === id ? 'library' : s.view
      }
    }),

  // 删除文件夹连带删除其中歌单
  deleteFolder: (id) =>
    set((s) => {
      const folder = s.folders.find((f) => f.id === id)
      if (!folder) return s
      const playlists = { ...s.playlists }
      for (const pid of folder.playlistIds) delete playlists[pid]
      return {
        playlists,
        folders: s.folders.filter((f) => f.id !== id),
        view: folder.playlistIds.includes(s.view) ? 'library' : s.view
      }
    }),

  // 同一首歌可加入多个歌单；同一歌单内重复添加则跳过。返回是否实际添加
  addTrackToPlaylist: (playlistId, trackId) => {
    const p = get().playlists[playlistId]
    if (!p || p.trackIds.includes(trackId)) return false
    set((s) => ({
      playlists: {
        ...s.playlists,
        [playlistId]: {
          ...s.playlists[playlistId],
          trackIds: [...s.playlists[playlistId].trackIds, trackId]
        }
      }
    }))
    return true
  },

  removeTrackFromPlaylist: (playlistId, trackId) =>
    set((s) => {
      const p = s.playlists[playlistId]
      if (!p) return s
      return {
        playlists: {
          ...s.playlists,
          [playlistId]: { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) }
        }
      }
    }),

  // 从音乐库删除：清掉所有歌单中的引用，不删磁盘文件
  deleteTrackFromLibrary: (trackId) =>
    set((s) => {
      const tracks = { ...s.tracks }
      delete tracks[trackId]
      const playlists = { ...s.playlists }
      for (const pid of Object.keys(playlists)) {
        if (playlists[pid].trackIds.includes(trackId)) {
          playlists[pid] = {
            ...playlists[pid],
            trackIds: playlists[pid].trackIds.filter((id) => id !== trackId)
          }
        }
      }
      return {
        tracks,
        trackOrder: s.trackOrder.filter((id) => id !== trackId),
        playlists
      }
    }),

  reorderPlaylist: (playlistId, fromIndex, toIndex) =>
    set((s) => {
      const p = s.playlists[playlistId]
      if (!p || fromIndex === toIndex) return s
      const trackIds = [...p.trackIds]
      const [moved] = trackIds.splice(fromIndex, 1)
      trackIds.splice(toIndex, 0, moved)
      return { playlists: { ...s.playlists, [playlistId]: { ...p, trackIds } } }
    }),

  // 歌单在根级与文件夹之间移动
  movePlaylist: (playlistId, folderId) =>
    set((s) => {
      if (!s.playlists[playlistId]) return s
      const inRoot = s.rootPlaylistIds.includes(playlistId)
      const currentFolder = s.folders.find((f) => f.playlistIds.includes(playlistId))
      if (folderId === (currentFolder?.id ?? null)) return s
      const folders = s.folders.map((f) => {
        let playlistIds = f.playlistIds
        if (f.id === currentFolder?.id) playlistIds = playlistIds.filter((id) => id !== playlistId)
        if (f.id === folderId) playlistIds = [...playlistIds, playlistId]
        return playlistIds === f.playlistIds ? f : { ...f, playlistIds }
      })
      let rootPlaylistIds = s.rootPlaylistIds
      if (folderId === null && !inRoot) rootPlaylistIds = [...rootPlaylistIds, playlistId]
      if (folderId !== null && inRoot)
        rootPlaylistIds = rootPlaylistIds.filter((id) => id !== playlistId)
      return {
        folders,
        rootPlaylistIds,
        expandedFolders: folderId ? { ...s.expandedFolders, [folderId]: true } : s.expandedFolders
      }
    })
}))
