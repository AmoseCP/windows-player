import { useLibrary } from './library'
import { usePlayer, currentTrackId } from './player'
import { applyColorTheme } from '../themes'
import type { AppData } from '../../../shared/types'

let ready = false // 加载完成前不触发保存，避免用空状态覆盖磁盘数据
let subscribed = false // StrictMode 下 effect 会跑两次，避免重复订阅导致双倍保存
let saveTimer: ReturnType<typeof setTimeout> | undefined

function collect(): AppData {
  const lib = useLibrary.getState()
  const player = usePlayer.getState()
  return {
    tracks: lib.tracks,
    trackOrder: lib.trackOrder,
    folders: lib.folders,
    playlists: lib.playlists,
    rootPlaylistIds: lib.rootPlaylistIds,
    youtubeHistory: lib.youtubeHistory,
    settings: {
      volume: player.volume,
      muted: player.muted,
      playMode: player.playMode,
      lastPlayedTrackId: currentTrackId(player),
      sidebarWidth: lib.sidebarWidth,
      sidebarCollapsed: lib.sidebarCollapsed,
      themeImage: lib.themeImage,
      colorTheme: lib.colorTheme
    }
  }
}

/**
 * 需要持久化的字段快照（引用/原始值），用于跳过无关变更。
 * 搜索词、提示、导入进度、当前视图等纯 UI 状态不该触发保存 —— 每次保存都要
 * 结构化克隆整个音乐库，大库下单次约 10ms，拖侧栏/打字会明显卡顿。
 */
function watched(): unknown[] {
  const lib = useLibrary.getState()
  const player = usePlayer.getState()
  return [
    lib.tracks,
    lib.trackOrder,
    lib.folders,
    lib.playlists,
    lib.rootPlaylistIds,
    lib.youtubeHistory,
    lib.sidebarWidth,
    lib.sidebarCollapsed,
    lib.themeImage,
    lib.colorTheme,
    player.volume,
    player.muted,
    player.playMode,
    currentTrackId(player)
  ]
}

let lastWatched: unknown[] | null = null

function flushSave(): void {
  if (saveTimer === undefined) return
  clearTimeout(saveTimer)
  saveTimer = undefined
  window.api.saveData(collect())
}

function onStoreChange(): void {
  if (!ready) return
  const next = watched()
  if (lastWatched && next.every((v, i) => v === lastWatched![i])) return
  lastWatched = next
  // 渲染进程侧防抖：高频变更（拖侧栏、批量导入）合并为一次克隆
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    window.api.saveData(collect())
  }, 400)
}

/** 启动时加载持久化数据注入 store，之后持久化字段变更触发保存 */
export async function initPersistence(): Promise<void> {
  if (subscribed) return
  const data = await window.api.loadData()
  if (data) {
    const tracks = data.tracks ?? {}
    const playlists = data.playlists ?? {}
    // 剔除指向已不存在曲目的引用，避免歌单显示行数与 trackIds 长度不一致
    const cleanedPlaylists: typeof playlists = {}
    for (const [id, p] of Object.entries(playlists)) {
      cleanedPlaylists[id] = { ...p, trackIds: (p.trackIds ?? []).filter((tid) => tracks[tid]) }
    }
    useLibrary.setState({
      tracks,
      trackOrder: (data.trackOrder ?? Object.keys(tracks)).filter((id) => tracks[id]),
      folders: data.folders ?? [],
      playlists: cleanedPlaylists,
      rootPlaylistIds: data.rootPlaylistIds ?? [],
      sidebarWidth: data.settings?.sidebarWidth ?? 220,
      sidebarCollapsed: data.settings?.sidebarCollapsed ?? false,
      themeImage: data.settings?.themeImage ?? null,
      colorTheme: data.settings?.colorTheme ?? 'dark',
      youtubeHistory: data.youtubeHistory ?? []
    })
    applyColorTheme(data.settings?.colorTheme ?? 'dark')
    const st = data.settings
    const last = st?.lastPlayedTrackId
    usePlayer.setState({
      volume: st?.volume ?? 0.8,
      muted: st?.muted ?? false,
      playMode: st?.playMode ?? 'order',
      // 上次播放曲目恢复为「已选中未播放」，不自动出声
      ...(last && tracks[last] ? { queue: [last], queueIndex: 0, playing: false } : {})
    })
  }
  ready = true
  lastWatched = watched()
  subscribed = true
  useLibrary.subscribe(onStoreChange)
  usePlayer.subscribe(onStoreChange)
  // 退出/刷新前立即落盘，避免防抖窗口内的改动丢失
  window.addEventListener('pagehide', flushSave)
  window.addEventListener('beforeunload', flushSave)
}
