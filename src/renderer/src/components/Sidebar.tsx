import { useMemo, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useLibrary, FOLDER_VIEW_PREFIX } from '../store/library'
import type { DirNode } from '../store/library'
import { buildFolderTree } from '../folderTree'
import { usePlayer } from '../store/player'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import ConfirmDialog from './ConfirmDialog'

interface SidebarProps {
  width: number
}

/** 歌单节点：可拖动（移动归属），也是歌曲/歌单的投放目标 */
function PlaylistNode({
  id,
  indent,
  active,
  draggable,
  onClick,
  onContextMenu,
  children
}: {
  id: string
  indent: boolean
  active: boolean
  draggable: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  children: React.ReactNode
}): React.JSX.Element {
  const drag = useDraggable({
    id: `playlist:${id}`,
    data: { type: 'playlist', playlistId: id },
    disabled: !draggable
  })
  const drop = useDroppable({ id: `drop-playlist:${id}` })
  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node)
        drop.setNodeRef(node)
      }}
      {...drag.attributes}
      {...drag.listeners}
      className={`sidebar-item${indent ? ' indent' : ''}${active ? ' active' : ''}${
        drop.isOver ? ' drop-over' : ''
      }${drag.isDragging ? ' dragging' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  )
}

/** 文件夹头部：歌单移动的投放目标 */
function FolderHeader({
  id,
  onClick,
  onContextMenu,
  children
}: {
  id: string
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-folder:${id}` })
  return (
    <div
      ref={setNodeRef}
      className={`sidebar-item${isOver ? ' drop-over' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  )
}

/** 目录树节点：可展开、可点选筛选该目录（含子目录）的曲目、可右键操作 */
function DirTreeNode({
  node,
  depth,
  onContextMenu
}: {
  node: DirNode
  depth: number
  onContextMenu: (e: React.MouseEvent, node: DirNode) => void
}): React.JSX.Element {
  const view = useLibrary((s) => s.view)
  const expanded = useLibrary((s) => !!s.expandedDirs[node.path])
  const viewKey = FOLDER_VIEW_PREFIX + node.path
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        className={`sidebar-item dir-item${view === viewKey ? ' active' : ''}`}
        style={{ paddingLeft: 14 + depth * 12 }}
        title={node.path}
        onClick={() => useLibrary.getState().setView(viewKey)}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        <span
          className="folder-caret"
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) useLibrary.getState().toggleDir(node.path)
          }}
        >
          {hasChildren ? (expanded ? '▾' : '▸') : ''}
        </span>
        <span>📂</span>
        <span className="dir-name">{node.name}</span>
        <span className="dir-count">{node.total}</span>
      </div>
      {expanded &&
        node.children.map((child) => (
          <DirTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  )
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

interface ConfirmState {
  title: string
  message: string
  onConfirm: () => void
}

function Sidebar({ width }: SidebarProps): React.JSX.Element {
  const folders = useLibrary((s) => s.folders)
  const playlists = useLibrary((s) => s.playlists)
  const rootPlaylistIds = useLibrary((s) => s.rootPlaylistIds)
  const view = useLibrary((s) => s.view)
  const expandedFolders = useLibrary((s) => s.expandedFolders)
  const {
    setView,
    toggleFolder,
    createPlaylist,
    createFolder,
    renamePlaylist,
    renameFolder,
    deletePlaylist,
    deleteFolder
  } = useLibrary.getState()

  const tracks = useLibrary((s) => s.tracks)
  const musicFolders = useLibrary((s) => s.musicFolders)
  const scanning = useLibrary((s) => s.scanning)
  const dirTree = useMemo(() => buildFolderTree(Object.values(tracks)), [tracks])

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; kind: 'playlist' | 'folder' } | null>(null)

  const openMenu = (e: React.MouseEvent, items: MenuItem[]): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // 音乐库右键：管理作为库来源的音乐文件夹
  const libraryMenu = (e: React.MouseEvent): void =>
    openMenu(e, [
      {
        label: '添加音乐文件夹…',
        onClick: () => void useLibrary.getState().addMusicFolder()
      },
      {
        label: scanning ? '正在扫描…' : '重新扫描音乐文件夹',
        disabled: scanning || musicFolders.length === 0,
        onClick: () => void useLibrary.getState().rescanMusicFolders()
      },
      ...(musicFolders.length > 0
        ? [
            {
              label: '移除音乐文件夹',
              submenu: musicFolders.map((f) => ({
                label: f,
                onClick: () => useLibrary.getState().removeMusicFolder(f)
              }))
            }
          ]
        : [])
    ])

  // 目录右键：播放 / 加入歌单 / 定位 / 从库中移除该目录下的曲目
  const dirMenu = (e: React.MouseEvent, node: DirNode): void => {
    const lib = useLibrary.getState()
    const ids = lib.tracksUnderDir(node.path)
    const isRoot = musicFolders.includes(node.path)
    const playlistItem = (pid: string): MenuItem => ({
      label: lib.playlists[pid]?.name ?? '',
      onClick: () => {
        const n = useLibrary.getState().addTracksToPlaylist(pid, ids)
        const name = useLibrary.getState().playlists[pid]?.name ?? ''
        usePlayer
          .getState()
          .showNotice(n > 0 ? `已添加 ${n} 首到歌单「${name}」` : `已在歌单「${name}」中`)
      }
    })
    openMenu(e, [
      {
        label: `播放此文件夹 (${ids.length} 首)`,
        disabled: ids.length === 0,
        onClick: () => usePlayer.getState().startQueue(ids, 0)
      },
      {
        label: '全部添加到歌单',
        disabled: ids.length === 0,
        submenu: [
          ...lib.folders.map((f) => ({ label: f.name, submenu: f.playlistIds.map(playlistItem) })),
          ...lib.rootPlaylistIds.map(playlistItem)
        ]
      },
      { label: '在文件管理器中打开', onClick: () => void window.api.revealInFolder(node.path) },
      ...(isRoot
        ? [
            {
              label: '取消登记为音乐文件夹',
              onClick: () => useLibrary.getState().removeMusicFolder(node.path)
            }
          ]
        : []),
      {
        label: `从音乐库移除 (${ids.length} 首)`,
        danger: true,
        disabled: ids.length === 0,
        onClick: () =>
          setConfirm({
            title: '从音乐库移除文件夹',
            message: `确定把「${node.name}」下的 ${ids.length} 首歌曲移出音乐库吗？磁盘文件不会被删除，重新扫描也不会再自动加回。`,
            onConfirm: () => {
              useLibrary.getState().deleteTracksFromLibrary(ids)
              for (const id of ids) usePlayer.getState().removeFromQueue(id)
              if (isRoot) useLibrary.getState().removeMusicFolder(node.path)
              useLibrary.getState().setView('library')
            }
          })
      }
    ])
  }

  const blankMenu = (e: React.MouseEvent): void =>
    openMenu(e, [
      {
        label: '新建歌单',
        onClick: () => setRenaming({ id: createPlaylist(null), kind: 'playlist' })
      },
      {
        label: '新建歌单文件夹',
        onClick: () => setRenaming({ id: createFolder(), kind: 'folder' })
      },
      {
        label: '导入歌单文件…',
        onClick: () => void useLibrary.getState().importPlaylistFile()
      }
    ])

  const folderMenu = (e: React.MouseEvent, folderId: string): void => {
    const folder = folders.find((f) => f.id === folderId)
    openMenu(e, [
      {
        label: '新建歌单',
        onClick: () => setRenaming({ id: createPlaylist(folderId), kind: 'playlist' })
      },
      { label: '重命名', onClick: () => setRenaming({ id: folderId, kind: 'folder' }) },
      {
        label: '删除文件夹',
        danger: true,
        onClick: () =>
          setConfirm({
            title: '删除歌单文件夹',
            message: `确定删除文件夹「${folder?.name}」吗？其中的 ${folder?.playlistIds.length ?? 0} 个歌单将被一并删除。`,
            onConfirm: () => deleteFolder(folderId)
          })
      }
    ])
  }

  const playlistMenu = (e: React.MouseEvent, playlistId: string): void => {
    const playlist = playlists[playlistId]
    openMenu(e, [
      { label: '重命名', onClick: () => setRenaming({ id: playlistId, kind: 'playlist' }) },
      {
        label: '导出为 m3u8 文件…',
        onClick: async () => {
          const lib = useLibrary.getState()
          const p = lib.playlists[playlistId]
          if (!p) return
          const entries = p.trackIds
            .map((id) => lib.tracks[id])
            .filter(Boolean)
            .map((t) => ({ path: t.path, title: t.title, duration: t.duration }))
          if (entries.length === 0) {
            usePlayer.getState().showNotice('歌单为空，无需导出')
            return
          }
          try {
            if (await window.api.exportPlaylist(p.name, entries)) {
              usePlayer.getState().showNotice(`已导出歌单「${p.name}」`)
            }
          } catch {
            usePlayer.getState().showNotice('导出失败')
          }
        }
      },
      {
        label: '删除歌单',
        danger: true,
        onClick: () =>
          setConfirm({
            title: '删除歌单',
            message: `确定删除歌单「${playlist?.name}」吗？（不会删除音乐库中的歌曲）`,
            onConfirm: () => deletePlaylist(playlistId)
          })
      }
    ])
  }

  const renderRename = (
    id: string,
    kind: 'playlist' | 'folder',
    currentName: string
  ): React.JSX.Element => (
    <input
      className="rename-input"
      defaultValue={currentName}
      autoFocus
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setRenaming(null)
          e.stopPropagation()
        }
      }}
      onBlur={(e) => {
        const name = e.target.value
        if (kind === 'playlist') renamePlaylist(id, name)
        else renameFolder(id, name)
        setRenaming(null)
      }}
    />
  )

  const renderPlaylist = (id: string, indent: boolean): React.JSX.Element | null => {
    const playlist = playlists[id]
    if (!playlist) return null
    const isRenaming = renaming?.id === id && renaming.kind === 'playlist'
    return (
      <PlaylistNode
        key={id}
        id={id}
        indent={indent}
        active={view === id}
        draggable={!isRenaming}
        onClick={() => setView(id)}
        onContextMenu={(e) => playlistMenu(e, id)}
      >
        <span>🎶</span>
        {isRenaming ? renderRename(id, 'playlist', playlist.name) : <span>{playlist.name}</span>}
      </PlaylistNode>
    )
  }

  const rootDrop = useDroppable({ id: 'drop-sidebar-root' })

  return (
    <nav
      ref={(node) => rootDrop.setNodeRef(node)}
      className="sidebar"
      style={{ width }}
      onContextMenu={blankMenu}
    >
      <div
        className={`sidebar-item${view === 'library' ? ' active' : ''}`}
        onClick={() => setView('library')}
        onContextMenu={(e) => libraryMenu(e)}
      >
        <span>🎵</span>
        <span>音乐库</span>
        {scanning && <span className="sidebar-badge">扫描中…</span>}
      </div>

      {/* 音乐库的磁盘目录树（由曲目路径派生） */}
      {dirTree.map((node) => (
        <DirTreeNode key={node.path} node={node} depth={0} onContextMenu={dirMenu} />
      ))}

      {folders.map((folder) => {
        const expanded = expandedFolders[folder.id]
        const isRenaming = renaming?.id === folder.id && renaming.kind === 'folder'
        return (
          <div key={folder.id}>
            <FolderHeader
              id={folder.id}
              onClick={() => toggleFolder(folder.id)}
              onContextMenu={(e) => folderMenu(e, folder.id)}
            >
              <span className="folder-caret">{expanded ? '▾' : '▸'}</span>
              <span>📁</span>
              {isRenaming ? (
                renderRename(folder.id, 'folder', folder.name)
              ) : (
                <span>{folder.name}</span>
              )}
            </FolderHeader>
            {expanded && folder.playlistIds.map((pid) => renderPlaylist(pid, true))}
          </div>
        )
      })}

      {rootPlaylistIds.map((pid) => renderPlaylist(pid, false))}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onConfirm={() => {
            confirm.onConfirm()
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </nav>
  )
}

export default Sidebar
