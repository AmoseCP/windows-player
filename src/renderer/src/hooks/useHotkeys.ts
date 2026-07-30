import { useEffect } from 'react'
import { usePlayer } from '../store/player'

/**
 * 空格 = 播放/暂停，Ctrl/Cmd+→ = 下一首，Ctrl/Cmd+← = 上一首；
 * 系统媒体键走同样的动作。在线播放期间全部禁用，避免与在线音频叠音。
 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      // 焦点在输入框时不拦截
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return
      const player = usePlayer.getState()
      if (player.showOnline) return // 在线播放期间禁用本地播放快捷键
      if (e.code === 'Space') {
        e.preventDefault()
        if (e.repeat) return // 长按空格不连发播放/暂停
        player.togglePlay()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
        // macOS 上 Ctrl+方向键被系统占用，同时接受 Cmd
        e.preventDefault()
        player.next(false)
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
        e.preventDefault()
        player.prev()
      }
    }
    window.addEventListener('keydown', onKey)

    // 系统媒体键（主进程 globalShortcut 转发，注册失败则收不到事件，静默降级）
    const offMedia = window.api.onMediaKey((action) => {
      const player = usePlayer.getState()
      if (player.showOnline) return // 在线播放期间媒体键不控制本地播放
      if (action === 'play-pause') player.togglePlay()
      else if (action === 'next') player.next(false)
      else if (action === 'prev') player.prev()
    })

    return () => {
      window.removeEventListener('keydown', onKey)
      offMedia()
    }
  }, [])
}
