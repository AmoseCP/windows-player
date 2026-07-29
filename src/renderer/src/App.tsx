import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import TrackList from './components/TrackList'
import PlayerBar from './components/PlayerBar'
import { useLibrary } from './store/library'
import { usePlayer } from './store/player'
import { initPersistence } from './store/persistence'
import { useHotkeys } from './hooks/useHotkeys'

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 400

/** 拖拽负载：歌曲行 或 侧栏歌单节点 */
export type DragData =
  { type: 'track'; trackId: string; index: number } | { type: 'playlist'; playlistId: string }

function App(): React.JSX.Element {
  const sidebarWidth = useLibrary((s) => s.sidebarWidth)
  const [resizing, setResizing] = useState(false)
  const [dragLabel, setDragLabel] = useState<string | null>(null)
  const dragging = useRef(false)
  const importPaths = useLibrary((s) => s.importPaths)
  const notice = usePlayer((s) => s.notice)

  // 距离阈值：区分点击/双击与拖拽
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useHotkeys()

  useEffect(() => {
    useLibrary.getState().init()
    initPersistence()
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
    setDragLabel(
      data.type === 'track'
        ? (s.tracks[data.trackId]?.title ?? '')
        : (s.playlists[data.playlistId]?.name ?? '')
    )
  }

  const onDragEnd = (e: DragEndEvent): void => {
    setDragLabel(null)
    const data = e.active.data.current as DragData | undefined
    if (!data || !e.over) return
    const lib = useLibrary.getState()

    if (data.type === 'track') {
      const overId = String(e.over.id)
      if (overId.startsWith('drop-playlist:')) {
        // 歌曲拖到侧栏歌单 = 添加（重复自动跳过）
        lib.addTrackToPlaylist(overId.slice('drop-playlist:'.length), data.trackId)
        return
      }
      const overData = e.over.data.current as DragData | undefined
      // 歌单内重排；搜索过滤时索引与 trackIds 不对应，禁用
      if (overData?.type === 'track' && lib.view !== 'library' && lib.search.trim() === '') {
        lib.reorderPlaylist(lib.view, data.index, overData.index)
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

  // 拖动分隔条调整侧栏宽度
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    setResizing(true)
    const onMove = (ev: MouseEvent): void => {
      if (!dragging.current) return
      useLibrary
        .getState()
        .setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX)))
    }
    const onUp = (): void => {
      dragging.current = false
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragLabel(null)}
      >
        <TopBar />
        <div className="app-middle">
          <Sidebar width={sidebarWidth} />
          <div
            className={`sidebar-resizer${resizing ? ' dragging' : ''}`}
            onMouseDown={startResize}
          />
          <main className="main-area">
            <TrackList />
          </main>
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
