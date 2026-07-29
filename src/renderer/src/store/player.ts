import { create } from 'zustand'
import type { PlayMode } from '../../../shared/types'

export type { PlayMode }

export const PLAY_MODE_ORDER: PlayMode[] = ['order', 'loop', 'single', 'shuffle']

interface PlayerState {
  queue: string[] // 播放队列 = 双击时所在视图的曲目 id 列表
  queueIndex: number // -1 = 未在播放
  playing: boolean
  playNonce: number // 每次显式开播 +1，用于重播同一首时重新加载
  volume: number // 0-1
  muted: boolean
  playMode: PlayMode
  history: number[] // 随机模式的「上一首」回退栈（队列下标）
  notice: string | null // 短暂提示（文件不存在 / 格式不支持）

  startQueue: (queue: string[], index: number) => void
  togglePlay: () => void
  next: (auto: boolean) => void
  prev: () => void
  setVolume: (v: number) => void
  toggleMute: () => void
  cyclePlayMode: () => void
  showNotice: (msg: string) => void
  removeFromQueue: (trackId: string) => void
}

export function currentTrackId(s: Pick<PlayerState, 'queue' | 'queueIndex'>): string | null {
  return s.queueIndex >= 0 ? (s.queue[s.queueIndex] ?? null) : null
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  queueIndex: -1,
  playing: false,
  playNonce: 0,
  volume: 0.8,
  muted: false,
  playMode: 'order',
  history: [],
  notice: null,

  startQueue: (queue, index) =>
    set((s) => ({
      queue,
      queueIndex: index,
      playing: true,
      history: [],
      playNonce: s.playNonce + 1
    })),

  togglePlay: () => {
    const s = get()
    if (s.queueIndex < 0) return
    set({ playing: !s.playing })
  },

  next: (auto) => {
    const s = get()
    const len = s.queue.length
    if (s.queueIndex < 0 || len === 0) return
    if (s.playMode === 'shuffle') {
      let idx = s.queueIndex
      if (len > 1) {
        do {
          idx = Math.floor(Math.random() * len)
        } while (idx === s.queueIndex)
      }
      set({
        queueIndex: idx,
        history: [...s.history, s.queueIndex],
        playing: true,
        playNonce: s.playNonce + 1
      })
      return
    }
    const nextIndex = s.queueIndex + 1
    if (nextIndex >= len) {
      if (s.playMode === 'loop' || s.playMode === 'single') {
        // 单曲循环下手动切歌按列表循环处理
        set({ queueIndex: 0, playing: true, playNonce: s.playNonce + 1 })
      } else if (auto) {
        set({ playing: false }) // 顺序播放：到末尾停止
      }
      return
    }
    set({ queueIndex: nextIndex, playing: true, playNonce: s.playNonce + 1 })
  },

  prev: () => {
    const s = get()
    if (s.queueIndex < 0 || s.queue.length === 0) return
    if (s.playMode === 'shuffle' && s.history.length > 0) {
      const history = [...s.history]
      const idx = history.pop()!
      set({ queueIndex: idx, history, playing: true, playNonce: s.playNonce + 1 })
      return
    }
    const prevIndex = s.queueIndex - 1
    if (prevIndex < 0) {
      if (s.playMode === 'loop') {
        set({ queueIndex: s.queue.length - 1, playing: true, playNonce: s.playNonce + 1 })
      }
      return
    }
    set({ queueIndex: prevIndex, playing: true, playNonce: s.playNonce + 1 })
  },

  setVolume: (v) => set({ volume: Math.min(1, Math.max(0, v)), muted: false }),

  toggleMute: () => set((s) => ({ muted: !s.muted })),

  cyclePlayMode: () =>
    set((s) => ({
      playMode: PLAY_MODE_ORDER[(PLAY_MODE_ORDER.indexOf(s.playMode) + 1) % PLAY_MODE_ORDER.length]
    })),

  showNotice: (msg) => {
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => set({ notice: null }), 3000)
    set({ notice: msg })
  },

  // 歌曲被从音乐库删除时同步清理播放队列
  removeFromQueue: (trackId) => {
    const s = get()
    const idx = s.queue.indexOf(trackId)
    if (idx < 0) return
    const queue = s.queue.filter((id) => id !== trackId)
    let queueIndex = s.queueIndex
    if (idx < queueIndex) {
      queueIndex--
    } else if (idx === queueIndex) {
      // 删的是当前曲目：顺延播放下一首，没有则停止
      if (queueIndex >= queue.length) queueIndex = queue.length - 1
      set({
        queue,
        queueIndex,
        history: [],
        playing: queueIndex >= 0 && s.playing,
        playNonce: s.playNonce + 1
      })
      return
    }
    set({ queue, queueIndex, history: [] })
  }
}))
