import { usePlayer, currentTrackId } from '../store/player'
import { useLibrary } from '../store/library'
import { useAudio } from '../hooks/useAudio'
import { localFileUrl } from '../utils'

/** 迷你模式：只显示核心播放控制，悬停显示放大按钮 */
function MiniPlayer(): React.JSX.Element {
  const trackId = usePlayer((s) => currentTrackId(s))
  const playing = usePlayer((s) => s.playing)
  const { togglePlay, next, prev, setMini } = usePlayer.getState()
  const track = useLibrary((s) => (trackId ? s.tracks[trackId] : null))
  const coversDir = useLibrary((s) => s.coversDir)
  // 迷你模式下 PlayerBar 卸载，由这里驱动 audio（进度/自动切歌等逻辑不中断）
  const { currentTime, duration } = useAudio()

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="mini-player">
      <div className="mini-cover">
        {track?.coverFile && coversDir ? (
          <img src={localFileUrl(`${coversDir}/${track.coverFile}`)} alt="" />
        ) : (
          '♪'
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
      {/* 悬停迷你窗口时立即显示的放大按钮 */}
      <button className="mini-expand" title="恢复完整界面" onClick={() => setMini(false)}>
        ⛶
      </button>
      <div className="mini-progress">
        <div className="mini-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  )
}

export default MiniPlayer
