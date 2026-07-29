import { useMemo, useState } from 'react'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLibrary } from '../store/library'
import { usePlayer, currentTrackId } from '../store/player'
import { localFileUrl, formatDuration } from '../utils'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import ConfirmDialog from './ConfirmDialog'
import type { Track } from '../../../shared/types'

type SortKey = 'title' | 'artist' | 'album' | 'duration'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: '标题' },
  { key: 'artist', label: '艺术家' },
  { key: 'album', label: '专辑' },
  { key: 'duration', label: '时长' }
]

function compareBy(key: SortKey, dir: 1 | -1): (a: Track, b: Track) => number {
  return (a, b) => {
    const r =
      key === 'duration' ? a.duration - b.duration : a[key].localeCompare(b[key], 'zh-Hans-CN')
    return r * dir
  }
}

interface TrackRowProps {
  track: Track
  index: number
  sortable: boolean // 歌单视图允许拖拽排序（应用位移动画）
  playing: boolean
  coversDir: string
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function TrackRow({
  track,
  index,
  sortable,
  playing,
  coversDir,
  onDoubleClick,
  onContextMenu
}: TrackRowProps): React.JSX.Element {
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
      style={
        sortable
          ? { transform: CSS.Transform.toString(transform), transition: transition ?? undefined }
          : undefined
      }
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <span className="track-index">{index + 1}</span>
      <span className="track-cover">
        {track.coverFile && coversDir ? (
          <img src={localFileUrl(`${coversDir}/${track.coverFile}`)} alt="" loading="lazy" />
        ) : (
          '♪'
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
    </div>
  )
}

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

  const toggleSort = (key: SortKey): void => {
    if (!isLibrary) return
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  }

  const trackMenu = (e: React.MouseEvent, track: Track): void => {
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
      ...(!isLibrary
        ? [
            {
              label: '从歌单中移除',
              onClick: () => useLibrary.getState().removeTrackFromPlaylist(view, track.id)
            }
          ]
        : []),
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
  }

  if (sorted.length === 0) {
    if (searching) {
      return (
        <div className="empty-state">
          <div className="empty-state-title">没有匹配的歌曲</div>
        </div>
      )
    }
    return (
      <div className="empty-state">
        {isLibrary ? (
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
    )
  }

  return (
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
      <SortableContext items={sorted.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {sorted.map((track, i) => (
          <TrackRow
            key={track.id}
            track={track}
            index={i}
            sortable={!isLibrary && !searching}
            playing={track.id === playingTrackId}
            coversDir={coversDir}
            onDoubleClick={() =>
              // 播放队列 = 当前视图顺序，从双击的歌曲开始
              usePlayer.getState().startQueue(
                sorted.map((t) => t.id),
                i
              )
            }
            onContextMenu={(e) => trackMenu(e, track)}
          />
        ))}
      </SortableContext>
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
