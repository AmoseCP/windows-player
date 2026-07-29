import { useEffect } from 'react'
import { usePlayer } from '../store/player'

/** 空格 = 播放/暂停，Ctrl+→ = 下一首，Ctrl+← = 上一首；系统媒体键走同样的动作 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      // 焦点在输入框时不拦截
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return
      const player = usePlayer.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        player.togglePlay()
      } else if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault()
        player.next(false)
      } else if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        player.prev()
      }
    }
    window.addEventListener('keydown', onKey)

    // 系统媒体键（主进程 globalShortcut 转发，注册失败则收不到事件，静默降级）
    const offMedia = window.api.onMediaKey((action) => {
      const player = usePlayer.getState()
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
