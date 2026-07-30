import { useEffect, useState } from 'react'
import { useLibrary } from '../store/library'
import { usePlayer } from '../store/player'
import ContextMenu from './ContextMenu'
import AboutDialog from './AboutDialog'
import UrlImportDialog from './UrlImportDialog'
import { COLOR_THEMES } from '../themes'

function TopBar(): React.JSX.Element {
  const importPaths = useLibrary((s) => s.importPaths)
  const progress = useLibrary((s) => s.importProgress)
  const search = useLibrary((s) => s.search)
  const themeImage = useLibrary((s) => s.themeImage)
  const [themeMenu, setThemeMenu] = useState<{ x: number; y: number } | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [showUrlImport, setShowUrlImport] = useState(false)
  const importing = progress !== null

  // 无边框窗口只在 Windows/Linux 需要自绘标题栏按钮
  const [isMac, setIsMac] = useState(true)
  useEffect(() => {
    window.api.getPlatform().then((p) => setIsMac(p === 'darwin'))
  }, [])

  const importFiles = async (): Promise<void> => {
    try {
      await importPaths(await window.api.pickFiles())
    } catch {
      usePlayer.getState().showNotice('导入失败，请重试')
    }
  }
  const importFolder = async (): Promise<void> => {
    try {
      await importPaths(await window.api.pickFolder())
    } catch {
      usePlayer.getState().showNotice('导入失败，请重试')
    }
  }

  const uploadTheme = async (): Promise<void> => {
    try {
      const path = await window.api.pickThemeImage()
      if (path) {
        useLibrary.getState().setThemeImage(path)
        usePlayer.getState().showNotice('已应用自定义背景')
      }
    } catch {
      usePlayer.getState().showNotice('背景图片应用失败')
    }
  }

  const sidebarCollapsed = useLibrary((s) => s.sidebarCollapsed)

  return (
    <header className="topbar">
      <button
        className="sidebar-toggle"
        title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
        onClick={() => useLibrary.getState().toggleSidebar()}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect
            x="3"
            y="4"
            width="18"
            height="16"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <line x1="9.5" y1="4" x2="9.5" y2="20" stroke="currentColor" strokeWidth="1.7" />
          {!sidebarCollapsed && (
            <rect x="4.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" />
          )}
        </svg>
      </button>
      <div className="topbar-title">Bethel Church Audio Player</div>
      <input
        className="topbar-search"
        type="text"
        placeholder="搜索标题 / 艺术家 / 专辑"
        value={search}
        onChange={(e) => useLibrary.getState().setSearch(e.target.value)}
      />
      <div className="topbar-actions">
        {importing && (
          <span className="import-progress">
            {progress.total > 0 ? `正在导入 ${progress.done}/${progress.total}` : '正在扫描…'}
          </span>
        )}
        <button className="btn" onClick={importFiles} disabled={importing}>
          导入文件
        </button>
        <button className="btn" onClick={importFolder} disabled={importing}>
          导入文件夹
        </button>
        <button
          className="btn"
          title="从音频直链下载并加入音乐库"
          onClick={() => setShowUrlImport(true)}
          disabled={importing}
        >
          从链接导入
        </button>
        <button
          className="btn"
          title="粘贴 YouTube 链接在线播放"
          onClick={() => usePlayer.getState().toggleOnline()}
        >
          在线
        </button>
        <button
          className="btn"
          title="主题设置"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setThemeMenu({ x: rect.left, y: rect.bottom + 4 })
          }}
        >
          主题
        </button>
        <button className="btn" title="关于本播放器" onClick={() => setShowAbout(true)}>
          关于
        </button>
      </div>
      {!isMac && (
        <div className="win-controls">
          <button
            className="win-btn"
            title="最小化"
            onClick={() => window.api.windowControl('minimize')}
          >
            ─
          </button>
          <button
            className="win-btn"
            title="最大化/还原"
            onClick={() => window.api.windowControl('toggleMaximize')}
          >
            ☐
          </button>
          <button
            className="win-btn close"
            title="关闭（最小化到托盘）"
            onClick={() => window.api.windowControl('close')}
          >
            ✕
          </button>
        </div>
      )}
      {themeMenu && (
        <ContextMenu
          x={themeMenu.x}
          y={themeMenu.y}
          items={[
            {
              label: '配色主题',
              submenu: Object.entries(COLOR_THEMES).map(([id, t]) => ({
                label: t.label,
                checked: useLibrary.getState().colorTheme === id,
                onClick: () => useLibrary.getState().setColorTheme(id)
              }))
            },
            { label: '上传背景图片…', onClick: uploadTheme },
            {
              label: '恢复默认背景',
              disabled: !themeImage,
              onClick: () => useLibrary.getState().setThemeImage(null)
            }
          ]}
          onClose={() => setThemeMenu(null)}
        />
      )}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showUrlImport && <UrlImportDialog onClose={() => setShowUrlImport(false)} />}
    </header>
  )
}

export default TopBar
