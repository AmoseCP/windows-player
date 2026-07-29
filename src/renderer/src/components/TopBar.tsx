import { useState } from 'react'
import { useLibrary } from '../store/library'
import { usePlayer } from '../store/player'
import ContextMenu from './ContextMenu'

function TopBar(): React.JSX.Element {
  const importPaths = useLibrary((s) => s.importPaths)
  const progress = useLibrary((s) => s.importProgress)
  const search = useLibrary((s) => s.search)
  const themeImage = useLibrary((s) => s.themeImage)
  const [themeMenu, setThemeMenu] = useState<{ x: number; y: number } | null>(null)
  const importing = progress !== null

  const importFiles = async (): Promise<void> => importPaths(await window.api.pickFiles())
  const importFolder = async (): Promise<void> => importPaths(await window.api.pickFolder())

  const uploadTheme = async (): Promise<void> => {
    const path = await window.api.pickThemeImage()
    if (path) {
      useLibrary.getState().setThemeImage(path)
      usePlayer.getState().showNotice('已应用自定义背景')
    }
  }

  return (
    <header className="topbar">
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
          title="主题设置"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setThemeMenu({ x: rect.left, y: rect.bottom + 4 })
          }}
        >
          主题
        </button>
      </div>
      {themeMenu && (
        <ContextMenu
          x={themeMenu.x}
          y={themeMenu.y}
          items={[
            { label: '上传背景图片…', onClick: uploadTheme },
            {
              label: '恢复默认主题',
              disabled: !themeImage,
              onClick: () => useLibrary.getState().setThemeImage(null)
            }
          ]}
          onClose={() => setThemeMenu(null)}
        />
      )}
    </header>
  )
}

export default TopBar
