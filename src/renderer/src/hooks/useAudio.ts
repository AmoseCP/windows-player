import { useEffect, useState } from 'react'
import { usePlayer, currentTrackId } from '../store/player'
import { useLibrary } from '../store/library'
import { localFileUrl } from '../utils'

// 单例 audio 元素：MP4 用 audio 加载天然只出声不出画
// 导出供歌词面板等只读订阅播放进度（写操作仅限本 hook）
export const audio = new Audio()

interface AudioState {
  currentTime: number
  duration: number
  seek: (time: number) => void
}

/** 把 player store 的播放意图同步到 <audio>，并回传播放进度（仅在 PlayerBar 使用一次） */
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
        player.showNotice(`文件不存在：${track.title}`)
      } else {
        player.showNotice(`该格式暂不支持播放：${track.title}`)
      }
      player.next(true)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('durationchange', onDuration)
    audio.addEventListener('loadstart', onReset)
    audio.addEventListener('emptied', onReset)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('durationchange', onDuration)
      audio.removeEventListener('loadstart', onReset)
      audio.removeEventListener('emptied', onReset)
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
