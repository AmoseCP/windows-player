import { useState } from 'react'
import { useLibrary } from '../store/library'
import { usePlayer } from '../store/player'
import type { Track } from '../../../shared/types'

interface Props {
  track: Track
  onClose: () => void
}

/** 编辑歌曲信息：只改播放器内的记录，不写回磁盘文件标签 */
function EditTrackDialog({ track, onClose }: Props): React.JSX.Element {
  const [title, setTitle] = useState(track.title)
  const [artist, setArtist] = useState(track.artist)
  const [album, setAlbum] = useState(track.album)

  const submit = (): void => {
    useLibrary.getState().updateTrack(track.id, { title, artist, album })
    usePlayer.getState().showNotice('歌曲信息已更新')
    onClose()
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog edit-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">编辑歌曲信息</div>
        <label className="edit-field">
          <span>标题</span>
          <input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <label className="edit-field">
          <span>艺术家</span>
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <label className="edit-field">
          <span>专辑</span>
          <input
            value={album}
            onChange={(e) => setAlbum(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <div className="edit-path" title={track.path}>
          {track.path}
        </div>
        <div className="dialog-message edit-note">
          仅修改播放器内的显示，不会改动音频文件本身的标签。
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn" onClick={submit}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

export default EditTrackDialog
