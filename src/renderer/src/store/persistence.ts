import { useLibrary } from './library'
import { usePlayer, currentTrackId } from './player'
import type { AppData } from '../../../shared/types'

let ready = false // 加载完成前不触发保存，避免用空状态覆盖磁盘数据

function collect(): AppData {
  const lib = useLibrary.getState()
  const player = usePlayer.getState()
  return {
    tracks: lib.tracks,
    trackOrder: lib.trackOrder,
    folders: lib.folders,
    playlists: lib.playlists,
    rootPlaylistIds: lib.rootPlaylistIds,
    settings: {
      volume: player.volume,
      muted: player.muted,
      playMode: player.playMode,
      lastPlayedTrackId: currentTrackId(player),
      sidebarWidth: lib.sidebarWidth,
      themeImage: lib.themeImage
    }
  }
}

function save(): void {
  if (ready) window.api.saveData(collect())
}

/** 启动时加载持久化数据注入 store，之后任何变更都触发（主进程防抖）保存 */
export async function initPersistence(): Promise<void> {
  const data = await window.api.loadData()
  if (data) {
    useLibrary.setState({
      tracks: data.tracks ?? {},
      trackOrder: data.trackOrder ?? Object.keys(data.tracks ?? {}),
      folders: data.folders ?? [],
      playlists: data.playlists ?? {},
      rootPlaylistIds: data.rootPlaylistIds ?? [],
      sidebarWidth: data.settings?.sidebarWidth ?? 220,
      themeImage: data.settings?.themeImage ?? null
    })
    const st = data.settings
    const last = st?.lastPlayedTrackId
    usePlayer.setState({
      volume: st?.volume ?? 0.8,
      muted: st?.muted ?? false,
      playMode: st?.playMode ?? 'order',
      // 上次播放曲目恢复为「已选中未播放」，不自动出声
      ...(last && data.tracks?.[last] ? { queue: [last], queueIndex: 0, playing: false } : {})
    })
  }
  ready = true
  useLibrary.subscribe(save)
  usePlayer.subscribe(save)
}
