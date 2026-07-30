import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import TrackList from './components/TrackList'
import PlayerBar from './components/PlayerBar'
import MiniPlayer from './components/MiniPlayer'
import LyricsPanel from './components/LyricsPanel'
import OnlinePlayer from './components/OnlinePlayer'
import QueuePanel from './components/QueuePanel'
import { useLibrary } from './store/library'
import { usePlayer } from './store/player'
import { initPersistence } from './store/persistence'
import { useHotkeys } from './hooks/useHotkeys'
import { localFileUrl } from './utils'

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 400

/** 拖拽负载：歌曲行 或 侧栏歌单节点 */
export type DragData =
  { type: 'track'; trackId: string; index: number } | { type: 'playlist'; playlistId: string }

// 侧栏整体是「歌单拖回根级」的投放目标，但它是大容器，pointerWithin 按角距排序时
// 会抢走内部歌单/文件夹节点的命中；有更具体的目标时将其排除
const collisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args)
  const specific = collisions.filter((c) => String(c.id) !== 'drop-sidebar-root')
  return specific.length > 0 ? specific : collisions
}

function App(): React.JSX.Element {
  const sidebarWidth = useLibrary((s) => s.sidebarWidth)
  const sidebarCollapsed = useLibrary((s) => s.sidebarCollapsed)
  const [resizing, setResizing] = useState(false)
  const [dragLabel, setDragLabel] = useState<string | null>(null)
  const importPaths = useLibrary((s) => s.importPaths)
  const notice = usePlayer((s) => s.notice)
  const miniMode = usePlayer((s) => s.miniMode)
  const showLyrics = usePlayer((s) => s.showLyrics)
  const showOnline = usePlayer((s) => s.showOnline)
  const showQueue = usePlayer((s) => s.showQueue)
  const themeImage = useLibrary((s) => s.themeImage)
  const themeVersion = useLibrary((s) => s.themeVersion)

  // 自定义背景：图片上叠加主题色渐变保证前景可读
  const themeStyle = themeImage
    ? {
        backgroundImage: `linear-gradient(var(--overlay), var(--overlay)), url("${localFileUrl(themeImage)}?v=${themeVersion}")`
      }
    : undefined

  // 距离阈值：区分点击/双击与拖拽
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useHotkeys()

  useEffect(() => {
    useLibrary.getState().init()
    initPersistence().then(() => {
      // 启动后清理不再被引用的封面缓存（歌曲删除后残留的孤儿文件）
      const used = Object.values(useLibrary.getState().tracks)
        .map((t) => t.coverFile)
        .filter((f): f is string => !!f)
      void window.api.gcCovers(used)
    })
    // 窗口关闭（隐藏到托盘）时立即停止本地与在线播放
    const offStop = window.api.onPlayerStop(() => {
      usePlayer.setState({ playing: false, showOnline: false })
    })
    // 文件关联：双击音频/歌单文件打开本应用 → 导入并立即播放
    const offOpen = window.api.onOpenFiles(async (files) => {
      const lib = useLibrary.getState()
      const playlists = files.filter((f) => /\.m3u8?$/i.test(f))
      const audios = files.filter((f) => !/\.m3u8?$/i.test(f))
      if (audios.length > 0) {
        const ids = await lib.importPathsAsTrackIds(audios)
        if (ids.length > 0) {
          useLibrary.getState().setView('library')
          usePlayer.getState().startQueue(ids, 0)
        }
      }
      // m3u 文件按歌单导入（逐个建立歌单）
      for (const f of playlists) await useLibrary.getState().importPlaylistFile(f)
    })
    return () => {
      offStop()
      offOpen()
    }
  }, [])

  // 文件/文件夹拖入窗口导入
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.api.getPathForFile(f))
        .filter(Boolean)
      importPaths(paths)
    },
    [importPaths]
  )

  const onDragStart = (e: DragStartEvent): void => {
    const data = e.active.data.current as DragData | undefined
    if (!data) return
    const s = useLibrary.getState()
    if (data.type === 'playlist') {
      setDragLabel(s.playlists[data.playlistId]?.name ?? '')
      return
    }
    const sel = s.selectedTrackIds
    const count = sel.has(data.trackId) && sel.size > 1 ? sel.size : 1
    const title = s.tracks[data.trackId]?.title ?? ''
    setDragLabel(count > 1 ? `${count} 首歌曲` : title)
  }

  const onDragEnd = (e: DragEndEvent): void => {
    setDragLabel(null)
    const data = e.active.data.current as DragData | undefined
    if (!data || !e.over) return
    const lib = useLibrary.getState()

    if (data.type === 'track') {
      // 拖动起点在选区内 → 整个选区一起操作
      const sel = lib.selectedTrackIds
      const ids = sel.has(data.trackId) && sel.size > 1 ? [...sel] : [data.trackId]
      const overId = String(e.over.id)
      if (overId.startsWith('drop-playlist:')) {
        // 歌曲拖到侧栏歌单 = 添加（重复自动跳过）
        const pid = overId.slice('drop-playlist:'.length)
        const n = lib.addTracksToPlaylist(pid, ids)
        const name = lib.playlists[pid]?.name ?? ''
        usePlayer
          .getState()
          .showNotice(
            n > 0
              ? `已添加${ids.length > 1 ? ` ${n} 首` : ''}到歌单「${name}」`
              : `已在歌单「${name}」中`
          )
        return
      }
      const overData = e.over.data.current as DragData | undefined
      // 歌单内重排；搜索过滤时顺序不完整，禁用
      if (overData?.type === 'track' && lib.view !== 'library' && lib.search.trim() === '') {
        if (ids.length > 1) lib.moveTracksInPlaylist(lib.view, ids, overData.trackId)
        else lib.reorderPlaylist(lib.view, data.trackId, overData.trackId)
      }
      return
    }

    // 歌单节点：优先命中文件夹，其次落回根级；忽略落在其他歌单上
    const collisionIds = (e.collisions ?? []).map((c) => String(c.id))
    const folderHit = collisionIds.find((id) => id.startsWith('drop-folder:'))
    if (folderHit) {
      lib.movePlaylist(data.playlistId, folderHit.slice('drop-folder:'.length))
    } else if (collisionIds.includes('drop-sidebar-root')) {
      lib.movePlaylist(data.playlistId, null)
    }
  }

  // 拖动分隔条调整侧栏宽度；用 AbortController 保证组件卸载时监听必被移除
  const resizeAbort = useRef<AbortController | null>(null)
  useEffect(() => () => resizeAbort.current?.abort(), [])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeAbort.current?.abort()
    const ac = new AbortController()
    resizeAbort.current = ac
    setResizing(true)
    const onMove = (ev: MouseEvent): void => {
      useLibrary
        .getState()
        .setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX)))
    }
    const onUp = (): void => {
      setResizing(false)
      ac.abort()
    }
    window.addEventListener('mousemove', onMove, { signal: ac.signal })
    window.addEventListener('mouseup', onUp, { signal: ac.signal })
  }, [])

  // 迷你模式：只渲染迷你播放条
  if (miniMode) {
    return (
      <div className="app mini" style={themeStyle}>
        <MiniPlayer />
        {notice && <div className="toast">{notice}</div>}
      </div>
    )
  }

  return (
    <div
      className={`app${themeImage ? ' themed' : ''}`}
      style={themeStyle}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragLabel(null)}
      >
        <TopBar />
        <div className="app-middle">
          {!sidebarCollapsed && (
            <>
              <Sidebar width={sidebarWidth} />
              <div
                className={`sidebar-resizer${resizing ? ' dragging' : ''}`}
                onMouseDown={startResize}
              />
            </>
          )}
          <main className="main-area">
            <TrackList />
            {showLyrics && <LyricsPanel />}
            {showOnline && <OnlinePlayer />}
          </main>
          {showQueue && <QueuePanel />}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragLabel !== null && <div className="drag-chip">{dragLabel}</div>}
        </DragOverlay>
      </DndContext>
      <PlayerBar />
      {notice && <div className="toast">{notice}</div>}
    </div>
  )
}

export default App
