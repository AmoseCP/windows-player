import { useEffect, useState } from 'react'
import { usePlayer, currentTrackId } from '../store/player'
import { useLibrary } from '../store/library'
import { useAudio } from '../hooks/useAudio'
import { localFileUrl } from '../utils'
import NoteIcon from './NoteIcon'

/** 迷你模式：无边框紧凑悬浮条，整体可拖动，悬停显示放大/关闭按钮 */
function MiniPlayer(): React.JSX.Element {
  const trackId = usePlayer((s) => currentTrackId(s))
  const playing = usePlayer((s) => s.playing)
  const { togglePlay, next, prev, setMini } = usePlayer.getState()
  const track = useLibrary((s) => (trackId ? s.tracks[trackId] : null))
  const coversDir = useLibrary((s) => s.coversDir)
  // 迷你模式下 PlayerBar 卸载，由这里驱动 audio（进度/自动切歌等逻辑不中断）
  const { currentTime, duration } = useAudio()
  // 拖动区域收不到 DOM 鼠标事件，悬停状态由主进程轮询光标位置推送
  const [hovered, setHovered] = useState(false)

  useEffect(() => window.api.onMiniHover(setHovered), [])

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`mini-player${hovered ? ' hovered' : ''}`}>
      <div className="mini-cover">
        {track?.coverFile && coversDir ? (
          <img src={localFileUrl(`${coversDir}/${track.coverFile}`)} alt="" />
        ) : (
          <NoteIcon size={16} />
        )}
      </div>
      <div className="mini-main">
        <div className="mini-title">{track ? track.title : '未在播放'}</div>
        <div className="mini-controls">
          <button className="control-btn" title="上一首" onClick={prev}>
            ⏮
          </button>
          <button className="control-btn play" title="播放/暂停" onClick={togglePlay}>
            {playing ? '⏸' : '▶'}
          </button>
          <button className="control-btn" title="下一首" onClick={() => next(false)}>
            ⏭
          </button>
        </div>
      </div>
      {/* 悬停迷你窗口时立即显示 */}
      <div className="mini-hover-actions">
        <button className="mini-action" title="恢复完整界面" onClick={() => setMini(false)}>
          ⛶
        </button>
        <button
          className="mini-action"
          title="关闭（最小化到托盘）"
          onClick={() => window.api.windowControl('close')}
        >
          ✕
        </button>
      </div>
      <div className="mini-progress">
        <div className="mini-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  )
}

export default MiniPlayer
