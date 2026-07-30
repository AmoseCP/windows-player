import { useEffect, useRef, useState } from 'react'
import { usePlayer, currentTrackId, PLAY_MODE_ORDER } from '../store/player'
import type { PlayMode } from '../store/player'
import { useLibrary } from '../store/library'
import { useAudio } from '../hooks/useAudio'
import { localFileUrl, formatDuration } from '../utils'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import NoteIcon from './NoteIcon'

const MODE_META: Record<PlayMode, { icon: string; label: string }> = {
  order: { icon: '➡', label: '顺序播放' },
  loop: { icon: '🔁', label: '列表循环' },
  single: { icon: '🔂', label: '单曲循环' },
  shuffle: { icon: '🔀', label: '随机播放' }
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SLEEP_MINUTES = [15, 30, 45, 60, 90]
const FADE_OPTIONS = [0, 1, 2, 4]

/** 睡眠定时器剩余时间，每秒刷新；未设置或尚未算出时返回 null（由调用方显示图标） */
function useSleepCountdown(sleepAt: number | null): string | null {
  // 带上 at 一起存，切换定时器时旧值自然失效，无需在 effect 内同步清空
  const [snap, setSnap] = useState<{ at: number; left: number } | null>(null)
  useEffect(() => {
    if (sleepAt === null) return
    const update = (): void =>
      setSnap({ at: sleepAt, left: Math.max(0, Math.round((sleepAt - Date.now()) / 1000)) })
    const raf = requestAnimationFrame(update) // 首次立即显示
    const t = setInterval(update, 1000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(t)
    }
  }, [sleepAt])
  if (sleepAt === null || snap?.at !== sleepAt) return null
  return `${Math.floor(snap.left / 60)}:${String(snap.left % 60).padStart(2, '0')}`
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
  const showQueue = usePlayer((s) => s.showQueue)
  const playbackRate = usePlayer((s) => s.playbackRate)
  const fadeSeconds = usePlayer((s) => s.fadeSeconds)
  const sleepAt = usePlayer((s) => s.sleepAt)
  const sleepAfterTrack = usePlayer((s) => s.sleepAfterTrack)
  const track = useLibrary((s) => (trackId ? s.tracks[trackId] : null))
  const coversDir = useLibrary((s) => s.coversDir)
  const { currentTime, duration, seek } = useAudio()
  const sleepLeft = useSleepCountdown(sleepAt)

  // 进度条拖动：拖动中显示预览位置，松手才真正 seek
  const [dragTime, setDragTime] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  // 弹出菜单（模式 / 速度 / 定时器）
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null)
  const [extraMenu, setExtraMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(
    null
  )

  const openModeMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setModeMenu({ x: rect.left, y: rect.top - 8 })
  }

  const openMenuAt = (e: React.MouseEvent, items: MenuItem[]): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    setExtraMenu({ x: rect.left - 60, y: rect.top - 8, items })
  }

  const rateItems: MenuItem[] = RATES.map((r) => ({
    label: r === 1 ? '正常速度 (1.0x)' : `${r.toFixed(2).replace(/0$/, '')}x`,
    checked: playbackRate === r,
    onClick: () => usePlayer.getState().setPlaybackRate(r)
  }))

  const sleepItems: MenuItem[] = [
    ...SLEEP_MINUTES.map((m) => ({
      label: `${m} 分钟后停止`,
      onClick: () => {
        usePlayer.getState().setSleepTimer(m)
        usePlayer.getState().showNotice(`将在 ${m} 分钟后停止播放`)
      }
    })),
    {
      label: '播完当前曲目后停止',
      checked: sleepAfterTrack,
      onClick: () => {
        usePlayer.getState().setSleepAfterTrack(true)
        usePlayer.getState().showNotice('播完当前曲目后将停止')
      }
    },
    {
      label: '取消定时',
      disabled: sleepAt === null && !sleepAfterTrack,
      onClick: () => usePlayer.getState().setSleepTimer(null)
    },
    {
      label: '淡入淡出',
      submenu: FADE_OPTIONS.map((s) => ({
        label: s === 0 ? '关闭' : `${s} 秒`,
        checked: fadeSeconds === s,
        onClick: () => usePlayer.getState().setFadeSeconds(s)
      }))
    }
  ]

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
  // 指针捕获被系统取消（切窗口、触控中断）时复位，否则进度显示会冻结在拖动位置
  const onProgressPointerCancel = (): void => setDragTime(null)

  const shownTime = dragTime ?? currentTime
  const progressPct = duration > 0 ? (shownTime / duration) * 100 : 0
  const mode = MODE_META[playMode]

  return (
    <footer className="playerbar">
      <div className="playerbar-cover">
        {track?.coverFile && coversDir ? (
          <img src={localFileUrl(`${coversDir}/${track.coverFile}`)} alt="" />
        ) : (
          <NoteIcon size={20} />
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
                onPointerCancel={onProgressPointerCancel}
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
          className={`control-btn${showQueue ? ' mode-btn active' : ''}`}
          title="播放队列"
          onClick={() => usePlayer.getState().toggleQueue()}
        >
          ☰
        </button>
        <button
          className={`control-btn${playbackRate !== 1 ? ' mode-btn active' : ''}`}
          title={`播放速度：${playbackRate}x`}
          onClick={(e) => openMenuAt(e, rateItems)}
        >
          {playbackRate === 1 ? '1x' : `${playbackRate}x`}
        </button>
        <button
          className={`control-btn${sleepAt !== null || sleepAfterTrack ? ' mode-btn active' : ''}`}
          title="睡眠定时器 / 淡入淡出"
          onClick={(e) => openMenuAt(e, sleepItems)}
        >
          {sleepLeft ?? '⏱'}
        </button>
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
        {extraMenu && (
          <ContextMenu
            x={extraMenu.x}
            y={extraMenu.y}
            items={extraMenu.items}
            onClose={() => setExtraMenu(null)}
          />
        )}
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
