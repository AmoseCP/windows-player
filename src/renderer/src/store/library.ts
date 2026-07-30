import { create } from 'zustand'
import type {
  Track,
  ImportProgress,
  Playlist,
  PlaylistFolder,
  YouTubeHistoryItem
} from '../../../shared/types'
import { applyColorTheme } from '../themes'
import { usePlayer } from './player'
import { isUnderDir } from '../folderTree'

function ytKey(videoId: string, listId: string | null): string {
  return `${videoId}|${listId ?? ''}`
}

/** 当前主区视图：'library' = 全部曲目，'folder:<绝对路径>' = 某个目录，否则为歌单 id */
export type View = 'library' | string

export const FOLDER_VIEW_PREFIX = 'folder:'

/** 音乐库的目录树节点（由曲目路径派生，不额外存储） */
export interface DirNode {
  name: string
  path: string
  children: DirNode[]
  total: number // 含子目录的曲目总数
}

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
  sidebarCollapsed: boolean
  search: string
  themeImage: string | null
  themeVersion: number // 同名文件被替换时用于刷新缓存
  colorTheme: string
  youtubeHistory: YouTubeHistoryItem[] // 在线播放记录，新的在前
  musicFolders: string[] // 登记为音乐库来源的根文件夹
  ignoredPaths: string[] // 手动删除过的文件，重新扫描不再加回
  expandedDirs: Record<string, boolean> // 文件夹树的展开状态
  scanning: boolean
  // 列表多选（不持久化）：放在 store 里供拖拽逻辑读取
  selectedTrackIds: Set<string>
  setSelectedTrackIds: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void

  init: () => Promise<void>
  setSidebarWidth: (w: number) => void
  toggleSidebar: () => void
  setSearch: (s: string) => void
  setThemeImage: (path: string | null) => void
  setColorTheme: (id: string) => void
  addYouTubeHistory: (item: Omit<YouTubeHistoryItem, 'playedAt'>) => void
  setYouTubeTitle: (videoId: string, listId: string | null, title: string) => void
  removeYouTubeHistory: (videoId: string, listId: string | null) => void
  importPaths: (paths: string[]) => Promise<void>
  /** 导入指定路径并返回对应的曲目 id（已在库中的复用现有 id），用于 m3u 歌单导入 */
  importPathsAsTrackIds: (paths: string[]) => Promise<string[]>
  importPlaylistFile: (file?: string) => Promise<void>
  /** 该目录（含子目录）下的全部曲目 id，按音乐库顺序 */
  tracksUnderDir: (dir: string) => string[]
  addMusicFolder: () => Promise<void>
  removeMusicFolder: (folder: string) => void
  rescanMusicFolders: (silent?: boolean) => Promise<void>
  toggleDir: (path: string) => void
  /** 从直接音频链接下载并入库，返回错误信息（成功为 null） */
  importFromUrl: (url: string) => Promise<string | null>
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
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) => number
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void
  removeTracksFromPlaylist: (playlistId: string, trackIds: string[]) => void
  deleteTrackFromLibrary: (trackId: string) => void
  deleteTracksFromLibrary: (trackIds: string[]) => void
  updateTrack: (trackId: string, patch: Partial<Pick<Track, 'title' | 'artist' | 'album'>>) => void
  reorderPlaylist: (playlistId: string, fromTrackId: string, toTrackId: string) => void
  /** 多选整体拖动：把选中的曲目整体移动到目标曲目位置 */
  moveTracksInPlaylist: (playlistId: string, movingIds: string[], toTrackId: string) => void
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
  sidebarCollapsed: false,
  search: '',
  themeImage: null,
  themeVersion: 0,
  colorTheme: 'dark',
  youtubeHistory: [],
  musicFolders: [],
  ignoredPaths: [],
  expandedDirs: {},
  scanning: false,
  selectedTrackIds: new Set<string>(),

  setSelectedTrackIds: (next) =>
    set((s) => ({
      selectedTrackIds: typeof next === 'function' ? next(s.selectedTrackIds) : next
    })),

  init: async () => {
    set({ coversDir: await window.api.getCoversDir() })
  },

  setSidebarWidth: (w) => set({ sidebarWidth: w }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setSearch: (search) => set({ search, selectedTrackIds: new Set<string>() }),

  setThemeImage: (themeImage) => set((s) => ({ themeImage, themeVersion: s.themeVersion + 1 })),

  setColorTheme: (colorTheme) => {
    applyColorTheme(colorTheme)
    set({ colorTheme })
  },

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

  importPathsAsTrackIds: async (paths) => {
    if (paths.length === 0) return []
    const byPath = new Map(Object.values(get().tracks).map((t) => [t.path, t.id]))
    const missing = paths.filter((p) => !byPath.has(p))
    if (missing.length > 0) {
      set({ importProgress: { done: 0, total: 0 } })
      const offProgress = window.api.onImportProgress((p) => set({ importProgress: p }))
      try {
        const added = await window.api.importPaths(missing, [...byPath.keys()])
        set((s) => {
          const tracks = { ...s.tracks }
          const trackOrder = [...s.trackOrder]
          for (const t of added) {
            tracks[t.id] = t
            trackOrder.push(t.id)
            byPath.set(t.path, t.id)
          }
          return { tracks, trackOrder }
        })
      } finally {
        offProgress()
        set({ importProgress: null })
      }
    }
    // 保持 m3u 文件内的原始顺序
    return paths.map((p) => byPath.get(p)).filter((id): id is string => !!id)
  },

  /** 导入 m3u/m3u8 → 导入其中曲目 → 新建同名歌单；不传路径时弹出选择框 */
  importPlaylistFile: async (file) => {
    const result = file ? await window.api.readPlaylist(file) : await window.api.importPlaylist()
    if (!result) return
    const trackIds = await get().importPathsAsTrackIds(result.paths)
    const id = crypto.randomUUID()
    set((s) => {
      const name = uniqueName(
        result.name || '导入的歌单',
        Object.values(s.playlists).map((p) => p.name)
      )
      return {
        playlists: { ...s.playlists, [id]: { id, name, trackIds } },
        rootPlaylistIds: [...s.rootPlaylistIds, id],
        view: id
      }
    })
  },

  importFromUrl: async (url) => {
    if (get().importProgress) return '正在导入中，请稍候'
    set({ importProgress: { done: 0, total: 1 } })
    try {
      const result = await window.api.importFromUrl(url)
      if ('error' in result) return result.error
      const track = result
      if (Object.values(get().tracks).some((t) => t.path === track.path)) return null
      set((s) => ({
        tracks: { ...s.tracks, [track.id]: track },
        trackOrder: [...s.trackOrder, track.id]
      }))
      return null
    } catch {
      return '下载失败，请检查链接与网络'
    } finally {
      set({ importProgress: null })
    }
  },

  tracksUnderDir: (dir) => {
    const s = get()
    return s.trackOrder.filter((id) => {
      const t = s.tracks[id]
      return t ? isUnderDir(t.path, dir) : false
    })
  },

  addMusicFolder: async () => {
    const folder = await window.api.pickMusicFolder()
    if (!folder) return
    if (get().musicFolders.includes(folder)) return
    set((s) => ({ musicFolders: [...s.musicFolders, folder] }))
    await get().rescanMusicFolders()
  },

  removeMusicFolder: (folder) =>
    set((s) => {
      const musicFolders = s.musicFolders.filter((f) => f !== folder)
      // 仅取消登记，已入库的曲目保留（用户可再手动删除）
      return {
        musicFolders,
        view: s.view === FOLDER_VIEW_PREFIX + folder ? 'library' : s.view
      }
    }),

  /** 重新扫描：新增入库、移动/改名的更新路径、消失的标灰 */
  rescanMusicFolders: async (silent) => {
    const { musicFolders, ignoredPaths, scanning, importProgress } = get()
    if (musicFolders.length === 0 || scanning || importProgress) return
    set({ scanning: true, importProgress: { done: 0, total: 0 } })
    const offProgress = window.api.onImportProgress((p) => set({ importProgress: p }))
    try {
      const known = Object.values(get().tracks).map((t) => ({
        id: t.id,
        path: t.path,
        size: t.size
      }))
      const r = await window.api.scanLibrary(musicFolders, known, ignoredPaths)
      set((s) => {
        const tracks = { ...s.tracks }
        const trackOrder = [...s.trackOrder]
        for (const { id, path } of r.relocated) {
          if (tracks[id]) tracks[id] = { ...tracks[id], path, missing: false }
        }
        for (const id of r.missingIds) {
          if (tracks[id]) tracks[id] = { ...tracks[id], missing: true }
        }
        for (const t of r.added) {
          tracks[t.id] = t
          trackOrder.push(t.id)
        }
        return { tracks, trackOrder }
      })
      if (!silent) {
        const parts: string[] = []
        if (r.added.length) parts.push(`新增 ${r.added.length} 首`)
        if (r.relocated.length) parts.push(`更新位置 ${r.relocated.length} 首`)
        if (r.missingIds.length) parts.push(`缺失 ${r.missingIds.length} 首`)
        usePlayer
          .getState()
          .showNotice(parts.length ? `扫描完成：${parts.join('，')}` : '扫描完成，没有变化')
      }
    } finally {
      offProgress()
      set({ scanning: false, importProgress: null })
    }
  },

  toggleDir: (path) =>
    set((s) => ({ expandedDirs: { ...s.expandedDirs, [path]: !s.expandedDirs[path] } })),

  markMissing: (id) =>
    set((s) => {
      const track = s.tracks[id]
      if (!track || track.missing) return s
      return { tracks: { ...s.tracks, [id]: { ...track, missing: true } } }
    }),

  // 切换视图/搜索时清空列表选区（选区随视图无意义）
  setView: (view) => set({ view, selectedTrackIds: new Set<string>() }),

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

  /** 批量加入歌单，返回实际新增数量 */
  addTracksToPlaylist: (playlistId, trackIds) => {
    const p = get().playlists[playlistId]
    if (!p) return 0
    const existing = new Set(p.trackIds)
    const fresh = trackIds.filter((id) => !existing.has(id))
    if (fresh.length === 0) return 0
    set((s) => ({
      playlists: {
        ...s.playlists,
        [playlistId]: {
          ...s.playlists[playlistId],
          trackIds: [...s.playlists[playlistId].trackIds, ...fresh]
        }
      }
    }))
    return fresh.length
  },

  removeTracksFromPlaylist: (playlistId, trackIds) =>
    set((s) => {
      const p = s.playlists[playlistId]
      if (!p) return s
      const drop = new Set(trackIds)
      return {
        playlists: {
          ...s.playlists,
          [playlistId]: { ...p, trackIds: p.trackIds.filter((id) => !drop.has(id)) }
        }
      }
    }),

  deleteTracksFromLibrary: (trackIds) =>
    set((s) => {
      const drop = new Set(trackIds)
      const tracks = { ...s.tracks }
      // 记下路径，重新扫描时不再自动加回
      const removedPaths = trackIds.map((id) => s.tracks[id]?.path).filter(Boolean) as string[]
      for (const id of drop) delete tracks[id]
      const playlists = { ...s.playlists }
      for (const pid of Object.keys(playlists)) {
        if (playlists[pid].trackIds.some((id) => drop.has(id))) {
          playlists[pid] = {
            ...playlists[pid],
            trackIds: playlists[pid].trackIds.filter((id) => !drop.has(id))
          }
        }
      }
      return {
        tracks,
        trackOrder: s.trackOrder.filter((id) => !drop.has(id)),
        playlists,
        ignoredPaths: [...new Set([...s.ignoredPaths, ...removedPaths])]
      }
    }),

  /** 编辑曲目信息：只改播放器内的记录，不写回磁盘文件标签 */
  updateTrack: (trackId, patch) =>
    set((s) => {
      const t = s.tracks[trackId]
      if (!t) return s
      const clean = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
      )
      return { tracks: { ...s.tracks, [trackId]: { ...t, ...clean } } }
    }),

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
      const removedPath = s.tracks[trackId]?.path
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
        playlists,
        ignoredPaths: removedPath ? [...new Set([...s.ignoredPaths, removedPath])] : s.ignoredPaths
      }
    }),

  // 按 trackId 定位而非显示下标：列表会过滤掉失效引用，下标可能与 trackIds 不对齐
  reorderPlaylist: (playlistId, fromTrackId, toTrackId) =>
    set((s) => {
      const p = s.playlists[playlistId]
      if (!p || fromTrackId === toTrackId) return s
      const from = p.trackIds.indexOf(fromTrackId)
      const to = p.trackIds.indexOf(toTrackId)
      if (from < 0 || to < 0) return s
      const trackIds = [...p.trackIds]
      const [moved] = trackIds.splice(from, 1)
      trackIds.splice(to, 0, moved)
      return { playlists: { ...s.playlists, [playlistId]: { ...p, trackIds } } }
    }),

  // 多选整体拖动：先摘出选中项，再插到目标位置（保持选中项之间的相对顺序）
  moveTracksInPlaylist: (playlistId, movingIds, toTrackId) =>
    set((s) => {
      const p = s.playlists[playlistId]
      if (!p || movingIds.includes(toTrackId)) return s
      const moving = new Set(movingIds)
      const kept = p.trackIds.filter((id) => !moving.has(id))
      const ordered = p.trackIds.filter((id) => moving.has(id))
      const at = kept.indexOf(toTrackId)
      if (at < 0 || ordered.length === 0) return s
      // 目标在选中项之后时插到其后，符合拖动方向的直觉
      const fromFirst = p.trackIds.findIndex((id) => moving.has(id))
      const toOriginal = p.trackIds.indexOf(toTrackId)
      const insertAt = toOriginal > fromFirst ? at + 1 : at
      const trackIds = [...kept.slice(0, insertAt), ...ordered, ...kept.slice(insertAt)]
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
