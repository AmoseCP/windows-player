import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLibrary } from '../store/library'
import { usePlayer, currentTrackId } from '../store/player'
import { localFileUrl, formatDuration } from '../utils'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import ConfirmDialog from './ConfirmDialog'
import NoteIcon from './NoteIcon'
import type { Track } from '../../../shared/types'

type SortKey = 'title' | 'artist' | 'album' | 'duration'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: '标题' },
  { key: 'artist', label: '艺术家' },
  { key: 'album', label: '专辑' },
  { key: 'duration', label: '时长' }
]

const ROW_HEIGHT = 48 // 与 .track-row 的 CSS 高度一致，虚拟滚动据此计算
const OVERSCAN = 8 // 视口外预渲染行数
const VIRTUAL_MIN = 120 // 超过此行数才启用虚拟滚动

// 单个 Collator 复用：localeCompare 带 locale 参数时每次调用都会构造排序器
const collator = new Intl.Collator('zh-Hans-CN')

function compareBy(key: SortKey, dir: 1 | -1): (a: Track, b: Track) => number {
  return (a, b) => {
    const r = key === 'duration' ? a.duration - b.duration : collator.compare(a[key], b[key])
    return r * dir
  }
}

interface RowProps {
  track: Track
  index: number
  playing: boolean
  coversDir: string
  onPlay: (index: number) => void
  onMenu: (e: React.MouseEvent, track: Track) => void
}

function RowContent({
  track,
  index,
  coversDir
}: {
  track: Track
  index: number
  coversDir: string
}): React.JSX.Element {
  return (
    <>
      <span className="track-index">{index + 1}</span>
      <span className="track-cover">
        {track.coverFile && coversDir ? (
          <img src={localFileUrl(`${coversDir}/${track.coverFile}`)} alt="" loading="lazy" />
        ) : (
          <NoteIcon size={16} />
        )}
      </span>
      <span className="track-title" title={track.title}>
        {track.title}
      </span>
      <span className="track-secondary" title={track.artist}>
        {track.artist}
      </span>
      <span className="track-secondary" title={track.album}>
        {track.album}
      </span>
      <span className="track-secondary">{formatDuration(track.duration)}</span>
    </>
  )
}

/** 普通行（音乐库视图 / 搜索中）：不注册 dnd 监听，避免大列表下拖拽测量卡顿 */
const PlainRow = memo(function PlainRow({
  track,
  index,
  playing,
  coversDir,
  onPlay,
  onMenu
}: RowProps): React.JSX.Element {
  return (
    <div
      className={`track-row${track.missing ? ' missing' : ''}${playing ? ' playing' : ''}`}
      onDoubleClick={() => onPlay(index)}
      onContextMenu={(e) => onMenu(e, track)}
    >
      <RowContent track={track} index={index} coversDir={coversDir} />
    </div>
  )
})

/** 可拖拽排序行（歌单视图且未搜索） */
const SortableRow = memo(function SortableRow({
  track,
  index,
  playing,
  coversDir,
  onPlay,
  onMenu
}: RowProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.id,
    data: { type: 'track', trackId: track.id, index }
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`track-row${track.missing ? ' missing' : ''}${playing ? ' playing' : ''}${
        isDragging ? ' dragging' : ''
      }`}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
      onDoubleClick={() => onPlay(index)}
      onContextMenu={(e) => onMenu(e, track)}
    >
      <RowContent track={track} index={index} coversDir={coversDir} />
    </div>
  )
})

function TrackList(): React.JSX.Element {
  const tracks = useLibrary((s) => s.tracks)
  const trackOrder = useLibrary((s) => s.trackOrder)
  const coversDir = useLibrary((s) => s.coversDir)
  const view = useLibrary((s) => s.view)
  const playlist = useLibrary((s) => (s.view === 'library' ? null : (s.playlists[s.view] ?? null)))
  const playingTrackId = usePlayer((s) => currentTrackId(s))
  const search = useLibrary((s) => s.search)
  // 列头排序状态；null = 默认按导入时间。仅音乐库视图可用，歌单内以手动顺序为准
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const isLibrary = view === 'library'
  const searching = search.trim() !== ''
  const sortable = !isLibrary && !searching

  const sorted = useMemo(() => {
    const ids = isLibrary ? trackOrder : (playlist?.trackIds ?? [])
    let list = ids.map((id) => tracks[id]).filter(Boolean)
    // 按 标题/艺术家/专辑 实时过滤（大小写不敏感）
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)
      )
    }
    if (isLibrary && sort) list.sort(compareBy(sort.key, sort.dir))
    return list
  }, [tracks, trackOrder, sort, isLibrary, playlist, search])

  const sortedIds = useMemo(() => sorted.map((t) => t.id), [sorted])

  // 虚拟滚动：仅渲染视口内的行，千首级列表才不会卡
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const virtual = sorted.length > VIRTUAL_MIN

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => setScrollTop(el.scrollTop)
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  // 切换视图/搜索后回到顶部，避免停留在超出新列表长度的位置
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [view, search])

  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0
  const end = virtual
    ? Math.min(sorted.length, Math.ceil((scrollTop + (viewportH || 800)) / ROW_HEIGHT) + OVERSCAN)
    : sorted.length
  const visible = virtual ? sorted.slice(start, end) : sorted

  const toggleSort = (key: SortKey): void => {
    if (!isLibrary) return
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  }

  // 稳定回调：避免每次父组件渲染都让所有行失去 memo 效果
  const onPlay = useCallback(
    (index: number) => {
      // 播放队列 = 当前视图顺序，从双击的歌曲开始
      usePlayer.getState().startQueue(sortedIds, index)
    },
    [sortedIds]
  )

  const onMenu = useCallback((e: React.MouseEvent, track: Track) => {
    e.preventDefault()
    const lib = useLibrary.getState()
    const playlistItem = (pid: string): MenuItem => ({
      label: lib.playlists[pid]?.name ?? '',
      onClick: () => {
        const added = useLibrary.getState().addTrackToPlaylist(pid, track.id)
        const name = useLibrary.getState().playlists[pid]?.name ?? ''
        usePlayer.getState().showNotice(added ? `已添加到歌单「${name}」` : `已在歌单「${name}」中`)
      }
    })
    // 级联子菜单：文件夹 → 歌单 分组，根级歌单直接列出
    const addSubmenu: MenuItem[] = [
      ...lib.folders.map((f) => ({ label: f.name, submenu: f.playlistIds.map(playlistItem) })),
      ...lib.rootPlaylistIds.map(playlistItem)
    ]
    const items: MenuItem[] = [
      { label: '添加到歌单', submenu: addSubmenu },
      ...(lib.view !== 'library'
        ? [
            {
              label: '从歌单中移除',
              onClick: () => useLibrary.getState().removeTrackFromPlaylist(lib.view, track.id)
            }
          ]
        : []),
      {
        label: '在文件夹中显示',
        onClick: () => window.api.revealInFolder(track.path)
      },
      {
        label: '从音乐库删除',
        danger: true,
        onClick: () =>
          setConfirm({
            message: `确定从音乐库删除「${track.title}」吗？该歌曲将同时从所有歌单移除，磁盘文件不会被删除。`,
            onConfirm: () => {
              useLibrary.getState().deleteTrackFromLibrary(track.id)
              usePlayer.getState().removeFromQueue(track.id)
            }
          })
      }
    ]
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])

  const rows = visible.map((track, i) => {
    const index = start + i
    const props: RowProps = {
      track,
      index,
      playing: track.id === playingTrackId,
      coversDir,
      onPlay,
      onMenu
    }
    return sortable ? (
      <SortableRow key={track.id} {...props} />
    ) : (
      <PlainRow key={track.id} {...props} />
    )
  })

  const body =
    sorted.length === 0 ? (
      <div className="empty-state">
        {searching ? (
          <div className="empty-state-title">没有匹配的歌曲</div>
        ) : isLibrary ? (
          <>
            <div className="empty-state-title">音乐库为空</div>
            <div>点击右上角「导入文件」或将音频文件拖入窗口</div>
          </>
        ) : (
          <>
            <div className="empty-state-title">歌单为空</div>
            <div>在音乐库中右键歌曲「添加到歌单」，或把歌曲拖到侧边栏歌单上</div>
          </>
        )}
      </div>
    ) : (
      <div className="tracklist">
        <div className="tracklist-header">
          <span>#</span>
          <span />
          {COLUMNS.map((col) => (
            <span
              key={col.key}
              className={isLibrary ? 'tracklist-sortable' : undefined}
              onClick={() => toggleSort(col.key)}
            >
              {col.label}
              {isLibrary && sort?.key === col.key && (
                <span className="sort-arrow">{sort.dir === 1 ? '▲' : '▼'}</span>
              )}
            </span>
          ))}
        </div>
        {/* 虚拟滚动：用上下留白撑出总高度，只挂载可见行 */}
        {virtual && start > 0 && <div style={{ height: start * ROW_HEIGHT }} />}
        {sortable ? (
          <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
            {rows}
          </SortableContext>
        ) : (
          rows
        )}
        {virtual && end < sorted.length && (
          <div style={{ height: (sorted.length - end) * ROW_HEIGHT }} />
        )}
      </div>
    )

  return (
    <div className="main-scroll" ref={scrollRef}>
      {body}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      {confirm && (
        <ConfirmDialog
          title="从音乐库删除"
          message={confirm.message}
          onConfirm={() => {
            confirm.onConfirm()
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

export default TrackList
