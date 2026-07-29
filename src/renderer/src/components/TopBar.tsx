import { useLibrary } from '../store/library'

function TopBar(): React.JSX.Element {
  const importPaths = useLibrary((s) => s.importPaths)
  const progress = useLibrary((s) => s.importProgress)
  const search = useLibrary((s) => s.search)
  const importing = progress !== null

  const importFiles = async (): Promise<void> => importPaths(await window.api.pickFiles())
  const importFolder = async (): Promise<void> => importPaths(await window.api.pickFolder())

  return (
    <header className="topbar">
      <div className="topbar-title">音乐播放器</div>
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
      </div>
    </header>
  )
}

export default TopBar
