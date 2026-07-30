import { useRef, useState } from 'react'
import { usePlayer, currentTrackId, PLAY_MODE_ORDER } from '../store/player'
import type { PlayMode } from '../store/player'
import { useLibrary } from '../store/library'
import { useAudio } from '../hooks/useAudio'
import { localFileUrl, formatDuration } from '../utils'
import ContextMenu from './ContextMenu'

const MODE_META: Record<PlayMode, { icon: string; label: string }> = {
  order: { icon: '➡', label: '顺序播放' },
  loop: { icon: '🔁', label: '列表循环' },
  single: { icon: '🔂', label: '单曲循环' },
  shuffle: { icon: '🔀', label: '随机播放' }
}

function PlayerBar(): React.JSX.Element {
  const trackId = usePlayer((s) => currentTrackId(s))
  const playing = usePlayer((s) => s.playing)
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const playMode = usePlayer((s) => s.playMode)
  const { togglePlay, next, prev, setVolume, toggleMute, cyclePlayMode } = usePlayer.getState()
  const showLyrics = usePlayer((s) => s.showLyrics)
  const showOnline = usePlayer((s) => s.showOnline)
  const track = useLibrary((s) => (trackId ? s.tracks[trackId] : null))
  const coversDir = useLibrary((s) => s.coversDir)
  const { currentTime, duration, seek } = useAudio()

  // 进度条拖动：拖动中显示预览位置，松手才真正 seek
  const [dragTime, setDragTime] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  // 播放模式选择菜单（模式按钮右键打开）
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null)

  const openModeMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setModeMenu({ x: rect.left, y: rect.top - 8 })
  }

  const timeFromEvent = (clientX: number): number => {
    const el = trackRef.current
    if (!el || !duration) return 0
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  const onProgressPointerDown = (e: React.PointerEvent): void => {
    if (!track || !duration) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragTime(timeFromEvent(e.clientX))
  }
  const onProgressPointerMove = (e: React.PointerEvent): void => {
    if (dragTime !== null) setDragTime(timeFromEvent(e.clientX))
  }
  const onProgressPointerUp = (e: React.PointerEvent): void => {
    if (dragTime !== null) {
      seek(timeFromEvent(e.clientX))
      setDragTime(null)
    }
  }

  const shownTime = dragTime ?? currentTime
  const progressPct = duration > 0 ? (shownTime / duration) * 100 : 0
  const mode = MODE_META[playMode]

  return (
    <footer className="playerbar">
      <div className="playerbar-cover">
        {track?.coverFile && coversDir ? (
          <img src={localFileUrl(`${coversDir}/${track.coverFile}`)} alt="" />
        ) : (
          '♪'
        )}
      </div>
      <div className="playerbar-meta">
        <div className="playerbar-title">{track ? track.title : '未在播放'}</div>
        <div className="playerbar-artist">{track ? track.artist : '—'}</div>
      </div>
      <div className="playerbar-center">
        {showOnline ? (
          // 在线播放期间隐藏本地播放控制，避免两路声音
          <div className="playerbar-online-hint">在线播放中 · 本地播放控制已停用</div>
        ) : (
          <>
            <div className="playerbar-controls">
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
            <div className="progress-row">
              <span>{formatDuration(shownTime)}</span>
              <div
                ref={trackRef}
                className="progress-track"
                onPointerDown={onProgressPointerDown}
                onPointerMove={onProgressPointerMove}
                onPointerUp={onProgressPointerUp}
              >
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span>{formatDuration(duration)}</span>
            </div>
          </>
        )}
      </div>
      <div className="playerbar-right">
        <button
          className={`control-btn${showLyrics ? ' mode-btn active' : ''}`}
          title="歌词"
          onClick={() => usePlayer.getState().toggleLyrics()}
        >
          词
        </button>
        <button
          className="control-btn"
          title="迷你模式"
          onClick={() => usePlayer.getState().setMini(true)}
        >
          ⧉
        </button>
        <button
          className={`control-btn mode-btn${playMode !== 'order' ? ' active' : ''}`}
          title={`播放模式：${mode.label}（点击切换，右键选择）`}
          onClick={cyclePlayMode}
          onContextMenu={openModeMenu}
        >
          {mode.icon}
        </button>
        {modeMenu && (
          <ContextMenu
            x={modeMenu.x}
            y={modeMenu.y}
            items={PLAY_MODE_ORDER.map((m) => ({
              label: `${MODE_META[m].icon} ${MODE_META[m].label}`,
              checked: m === playMode,
              onClick: () => usePlayer.getState().setPlayMode(m)
            }))}
            onClose={() => setModeMenu(null)}
          />
        )}
        <button className="control-btn" title={muted ? '取消静音' : '静音'} onClick={toggleMute}>
          {muted || volume === 0 ? '🔇' : '🔊'}
        </button>
        <input
          className="volume-slider"
          type="range"
          min={0}
          max={100}
          value={muted ? 0 : Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
        />
      </div>
    </footer>
  )
}

export default PlayerBar
