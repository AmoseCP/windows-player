import { useState } from 'react'
import { useLibrary } from '../store/library'
import { usePlayer } from '../store/player'

interface Props {
  onClose: () => void
}

/** 从直接音频链接导入（不解析流媒体站点，需指向音频文件本身） */
function UrlImportDialog({ onClose }: Props): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const value = url.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    const err = await useLibrary.getState().importFromUrl(value)
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    usePlayer.getState().showNotice('已下载并加入音乐库')
    onClose()
  }

  return (
    <div className="dialog-overlay" onMouseDown={busy ? undefined : onClose}>
      <div className="dialog url-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">从链接导入音频</div>
        <input
          className="url-input"
          placeholder="https://example.org/songs/诗歌.mp3"
          value={url}
          autoFocus
          disabled={busy}
          onChange={(e) => {
            setUrl(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <div className="url-error">{error}</div>}
        <div className="dialog-message url-note">
          需填写指向音频文件本身的直接链接（如教会网站上的 .mp3 / .m4a）。 文件将下载到「音乐 /
          Bethel Church Audio Player」文件夹并加入音乐库。
          <br />
          不支持 YouTube 等流媒体页面链接 —— 这类内容请到「在线」面板播放或下载音频。
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn" onClick={submit} disabled={busy || url.trim() === ''}>
            {busy ? '下载中…' : '下载并导入'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default UrlImportDialog
