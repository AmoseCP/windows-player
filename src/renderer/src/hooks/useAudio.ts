import { useEffect, useState } from 'react'
import { usePlayer, currentTrackId } from '../store/player'
import { useLibrary } from '../store/library'
import { resumeAnalyserContext } from '../visualizer'
import { localFileUrl } from '../utils'

// 单例 audio 元素：MP4 用 audio 加载天然只出声不出画
// 导出供歌词面板等只读订阅播放进度（写操作仅限本 hook）
export const audio = new Audio()
// CORS 模式加载（localfile 协议已返回 ACAO 头），Web Audio 分析器才能读到真实数据
audio.crossOrigin = 'anonymous'

// 已应用到 audio 元素的曲目标识（模块级）：PlayerBar 与 MiniPlayer 互斥挂载，
// 切换迷你模式会重新执行加载 effect，若无条件重设 src 会导致重新加载、进度归零
let appliedKey = ''
// 连续播放失败计数：整队列都无法播放时停下来，不做无限重试
let consecutiveErrors = 0

interface AudioState {
  currentTime: number
  duration: number
  seek: (time: number) => void
}

/** 把 player store 的播放意图同步到 <audio>，并回传播放进度（同一时刻仅一处使用） */
export function useAudio(): AudioState {
  const trackId = usePlayer((s) => currentTrackId(s))
  const playNonce = usePlayer((s) => s.playNonce)
  const playing = usePlayer((s) => s.playing)
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const metaDuration = useLibrary((s) => (trackId ? (s.tracks[trackId]?.duration ?? 0) : 0))
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  // audio 实际时长优先，加载完成前用导入时解析的元数据时长
  const duration = audioDuration || metaDuration

  // 切歌 / 重播：重新加载源（进度复位由 loadstart/emptied 事件完成）
  useEffect(() => {
    const track = trackId ? useLibrary.getState().tracks[trackId] : null
    const key = track ? `${track.id}|${playNonce}` : ''
    if (key === appliedKey) {
      // 仅组件重新挂载（如切换迷你模式），保持当前播放位置
      return
    }
    appliedKey = key
    if (!track) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      return
    }
    audio.src = localFileUrl(track.path)
    if (usePlayer.getState().playing) {
      audio.play().catch(() => {}) // 加载失败走 error 事件统一处理
    }
  }, [trackId, playNonce])

  // 播放 / 暂停
  useEffect(() => {
    if (playing && audio.src) {
      resumeAnalyserContext() // 可视化建立的音频图若被挂起会导致无声
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [playing])

  useEffect(() => {
    audio.volume = volume
    audio.muted = muted
  }, [volume, muted])

  // 进度、自然结束、播放错误
  useEffect(() => {
    const onTime = (): void => setCurrentTime(audio.currentTime)
    const onDuration = (): void => {
      if (isFinite(audio.duration)) setAudioDuration(audio.duration)
    }
    const onReset = (): void => {
      setCurrentTime(0)
      setAudioDuration(0)
    }
    const onPlaying = (): void => {
      consecutiveErrors = 0
    }
    const onEnded = (): void => {
      if (usePlayer.getState().playMode === 'single') {
        audio.currentTime = 0
        audio.play().catch(() => {})
      } else {
        usePlayer.getState().next(true)
      }
    }
    const onError = async (): Promise<void> => {
      const player = usePlayer.getState()
      const id = currentTrackId(player)
      const track = id ? useLibrary.getState().tracks[id] : null
      if (!track) return
      const exists = await window.api.checkExists(track.path)
      if (!exists) {
        useLibrary.getState().markMissing(track.id)
      }
      consecutiveErrors++
      // 队列内每首都失败（例如音乐盘未挂载）时停止，避免错误→切歌→错误的死循环
      if (consecutiveErrors >= Math.max(1, player.queue.length)) {
        consecutiveErrors = 0
        usePlayer.setState({ playing: false })
        audio.pause()
        player.showNotice(
          exists ? `该格式暂不支持播放：${track.title}` : `文件不存在：${track.title}`
        )
        return
      }
      player.showNotice(
        exists ? `该格式暂不支持播放：${track.title}` : `文件不存在：${track.title}`
      )
      player.next(true)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('durationchange', onDuration)
    audio.addEventListener('loadstart', onReset)
    audio.addEventListener('emptied', onReset)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('durationchange', onDuration)
      audio.removeEventListener('loadstart', onReset)
      audio.removeEventListener('emptied', onReset)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [])

  const seek = (time: number): void => {
    if (audio.src && isFinite(time)) {
      audio.currentTime = Math.min(Math.max(0, time), duration || 0)
      setCurrentTime(audio.currentTime)
    }
  }

  return { currentTime, duration, seek }
}
