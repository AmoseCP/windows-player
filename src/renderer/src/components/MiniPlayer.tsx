import { useEffect, useState } from 'react'
import { usePlayer, currentTrackId } from '../store/player'
import { useLibrary } from '../store/library'
import { useAudio } from '../hooks/useAudio'
import { localFileUrl } from '../utils'
import { getOnlineStatus, toggleOnlinePlay } from '../onlineControl'
import type { OnlineStatus } from '../onlineControl'
import NoteIcon from './NoteIcon'

/** 迷你模式：无边框紧凑悬浮条，整体可拖动，悬停显示放大/关闭按钮 */
function MiniPlayer(): React.JSX.Element {
  const trackId = usePlayer((s) => currentTrackId(s))
  const playing = usePlayer((s) => s.playing)
  // 与 PlayerBar 一致：在线面板打开时本地控制停用，迷你条转而控制在线播放
  const onlineMode = usePlayer((s) => s.showOnline)
  const activeTabId = usePlayer((s) => s.activeTabId)
  const onlineTitle = usePlayer((s) => {
    const tab = s.onlineTabs.find((t) => t.id === s.activeTabId)
    return tab ? tab.title.replace(/\s*-\s*YouTube\s*$/, '').trim() : null
  })
  const { togglePlay, next, prev, setMini } = usePlayer.getState()
  const track = useLibrary((s) => (trackId ? s.tracks[trackId] : null))
  const coversDir = useLibrary((s) => s.coversDir)
  // 迷你模式下 PlayerBar 卸载，由这里驱动 audio（进度/自动切歌等逻辑不中断）
  const { currentTime, duration } = useAudio()
  // 拖动区域收不到 DOM 鼠标事件，悬停状态由主进程轮询光标位置推送
  const [hovered, setHovered] = useState(false)
  // 在线播放状态：轮询当前标签 webview 中的视频
  const [polled, setOnline] = useState<OnlineStatus | null>(null)

  useEffect(() => window.api.onMiniHover(setHovered), [])

  useEffect(() => {
    if (!onlineMode || !activeTabId) return
    let alive = true
    const refresh = (): void => {
      void getOnlineStatus(activeTabId).then((s) => {
        if (alive) setOnline(s)
      })
    }
    refresh()
    const timer = setInterval(refresh, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [onlineMode, activeTabId])

  // 面板关闭/无标签时忽略上一轮轮询的残留状态
  const online = onlineMode && activeTabId ? polled : null

  const isPlaying = onlineMode ? (online?.playing ?? false) : playing
  const title = onlineMode ? (onlineTitle ?? '未在播放') : track ? track.title : '未在播放'
  const progressPct = onlineMode
    ? online && online.duration > 0
      ? (online.currentTime / online.duration) * 100
      : 0
    : duration > 0
      ? (currentTime / duration) * 100
      : 0

  const onToggle = (): void => {
    if (!onlineMode) {
      togglePlay()
      return
    }
    if (!activeTabId) return
    toggleOnlinePlay(activeTabId)
    // 先乐观翻转按钮状态，下一轮轮询会校正
    setOnline((s) => (s ? { ...s, playing: !s.playing } : s))
  }

  return (
    <div className={`mini-player${hovered ? ' hovered' : ''}`}>
      <div className="mini-cover">
        {!onlineMode && track?.coverFile && coversDir ? (
          <img src={localFileUrl(`${coversDir}/${track.coverFile}`)} alt="" />
        ) : (
          <NoteIcon size={16} />
        )}
      </div>
      <div className="mini-main">
        <div className="mini-title">{title}</div>
        <div className="mini-controls">
          {/* 在线模式只提供播放/暂停：切换视频请回完整界面（播完会自动连播） */}
          {!onlineMode && (
            <button className="control-btn" title="上一首" onClick={prev}>
              ⏮
            </button>
          )}
          <button className="control-btn play" title="播放/暂停" onClick={onToggle}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          {!onlineMode && (
            <button className="control-btn" title="下一首" onClick={() => next(false)}>
              ⏭
            </button>
          )}
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
