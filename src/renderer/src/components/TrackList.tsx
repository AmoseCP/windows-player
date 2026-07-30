import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLibrary } from '../store/library'
import { usePlayer, currentTrackId } from '../store/player'
import { localFileUrl, formatDuration } from '../utils'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import ConfirmDialog from './ConfirmDialog'
import EditTrackDialog from './EditTrackDialog'
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
  selected: boolean
  coversDir: string
  onPlay: (index: number) => void
  onMenu: (e: React.MouseEvent, track: Track) => void
  onSelect: (e: React.MouseEvent, index: number) => void
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
  selected,
  coversDir,
  onPlay,
  onMenu,
  onSelect
}: RowProps): React.JSX.Element {
  return (
    <div
      className={`track-row${track.missing ? ' missing' : ''}${playing ? ' playing' : ''}${
        selected ? ' selected' : ''
      }`}
      onMouseDown={(e) => onSelect(e, index)}
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
  selected,
  coversDir,
  onPlay,
  onMenu,
  onSelect
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
      }${selected ? ' selected' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
      onMouseDown={(e) => onSelect(e, index)}
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
  const [editing, setEditing] = useState<Track | null>(null)
  // 多选：选中的曲目 id 与 Shift 范围选的锚点
  const selected = useLibrary((s) => s.selectedTrackIds)
  const setSelected = useLibrary.getState().setSelectedTrackIds
  const anchorRef = useRef<number | null>(null) // Shift 范围选锚点；用 ref 避免连点时读到旧值
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

  // 切换视图/搜索后回到顶部（选区由 store 在 setView/setSearch 时清空）
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [view, search])

  // Ctrl/Cmd+A 全选当前列表，Esc 取消选择
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(new Set(sortedIds))
      } else if (e.key === 'Escape') {
        setSelected(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sortedIds])

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

  // Ctrl/Cmd 点选、Shift 范围选；不带修饰键点击时只选中该行
  const onSelect = useCallback(
    (e: React.MouseEvent, index: number) => {
      if (e.button !== 0) return
      const id = sortedIds[index]
      if (!id) return
      const anchor = anchorRef.current
      if (e.shiftKey && anchor !== null) {
        const [a, b] = anchor <= index ? [anchor, index] : [index, anchor]
        setSelected(new Set(sortedIds.slice(a, b + 1)))
        return
      }
      if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        anchorRef.current = index
        return
      }
      // 点在已选区域内则保留选区（便于整体拖动），否则重置为单选
      setSelected((prev) => (prev.has(id) && prev.size > 1 ? prev : new Set([id])))
      anchorRef.current = index
    },
    [sortedIds]
  )

  const onMenu = useCallback(
    (e: React.MouseEvent, track: Track) => {
      e.preventDefault()
      const lib = useLibrary.getState()
      // 右键落在选区内 → 操作整个选区；否则只操作该行
      const targets = selected.has(track.id) && selected.size > 1 ? [...selected] : [track.id]
      const many = targets.length > 1
      const suffix = many ? ` (${targets.length} 首)` : ''

      const playlistItem = (pid: string): MenuItem => ({
        label: lib.playlists[pid]?.name ?? '',
        onClick: () => {
          const n = useLibrary.getState().addTracksToPlaylist(pid, targets)
          const name = useLibrary.getState().playlists[pid]?.name ?? ''
          usePlayer
            .getState()
            .showNotice(n > 0 ? `已添加 ${n} 首到歌单「${name}」` : `已在歌单「${name}」中`)
        }
      })
      // 级联子菜单：文件夹 → 歌单 分组，根级歌单直接列出
      const addSubmenu: MenuItem[] = [
        ...lib.folders.map((f) => ({ label: f.name, submenu: f.playlistIds.map(playlistItem) })),
        ...lib.rootPlaylistIds.map(playlistItem)
      ]
      const items: MenuItem[] = [
        { label: `添加到歌单${suffix}`, submenu: addSubmenu },
        ...(lib.view !== 'library'
          ? [
              {
                label: `从歌单中移除${suffix}`,
                onClick: () => {
                  useLibrary.getState().removeTracksFromPlaylist(lib.view, targets)
                  setSelected(new Set())
                }
              }
            ]
          : []),
        ...(many
          ? []
          : [
              { label: '编辑歌曲信息…', onClick: () => setEditing(track) },
              { label: '在文件夹中显示', onClick: () => window.api.revealInFolder(track.path) }
            ]),
        {
          label: `从音乐库删除${suffix}`,
          danger: true,
          onClick: () =>
            setConfirm({
              message: many
                ? `确定从音乐库删除选中的 ${targets.length} 首歌曲吗？它们将同时从所有歌单移除，磁盘文件不会被删除。`
                : `确定从音乐库删除「${track.title}」吗？该歌曲将同时从所有歌单移除，磁盘文件不会被删除。`,
              onConfirm: () => {
                useLibrary.getState().deleteTracksFromLibrary(targets)
                for (const id of targets) usePlayer.getState().removeFromQueue(id)
                setSelected(new Set())
              }
            })
        }
      ]
      setMenu({ x: e.clientX, y: e.clientY, items })
    },
    [selected]
  )

  const rows = visible.map((track, i) => {
    const index = start + i
    const props: RowProps = {
      track,
      index,
      playing: track.id === playingTrackId,
      selected: selected.has(track.id),
      coversDir,
      onPlay,
      onMenu,
      onSelect
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
      {editing && <EditTrackDialog track={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

export default TrackList
