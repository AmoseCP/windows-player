// 开发模式下暴露给自动化测试（CDP 驱动）的钩子；生产构建不会包含本模块
import { useLibrary } from './store/library'
import { usePlayer } from './store/player'
import { audio } from './hooks/useAudio'

declare global {
  interface Window {
    __test?: {
      useLibrary: typeof useLibrary
      usePlayer: typeof usePlayer
      audio: HTMLAudioElement
    }
  }
}

window.__test = { useLibrary, usePlayer, audio }
