// 在线面板外的组件（迷你条）需要控制 webview 中的播放：
// TabView 挂载时把 webview 元素按标签 id 登记到这里，卸载时移除

export interface WebviewElement extends HTMLElement {
  setAudioMuted?: (muted: boolean) => void
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>
}

const registry = new Map<string, WebviewElement>()

export function registerWebview(tabId: string, el: WebviewElement | null): void {
  if (el) registry.set(tabId, el)
  else registry.delete(tabId)
}

export interface OnlineStatus {
  playing: boolean
  currentTime: number // 秒
  duration: number // 秒；直播为 Infinity → 序列化后为 null，按 0 处理
}

async function run(tabId: string, code: string): Promise<unknown> {
  const el = registry.get(tabId)
  if (!el?.executeJavaScript) return null
  try {
    return await el.executeJavaScript(code)
  } catch {
    return null // webview 尚未加载完成
  }
}

/** 读取当前标签页视频的播放状态；页面里没有视频返回 null */
export async function getOnlineStatus(tabId: string): Promise<OnlineStatus | null> {
  const res = (await run(
    tabId,
    `(() => {
      const v = document.querySelector('video')
      if (!v) return null
      return {
        playing: !v.paused && !v.ended,
        currentTime: v.currentTime || 0,
        duration: isFinite(v.duration) ? v.duration : 0
      }
    })()`
  )) as OnlineStatus | null
  return res && typeof res.playing === 'boolean' ? res : null
}

export function toggleOnlinePlay(tabId: string): void {
  void run(
    tabId,
    `(() => {
      const v = document.querySelector('video')
      if (v) { if (v.paused) v.play(); else v.pause() }
    })()`
  )
}

// 注：不提供在线的「上/下一个视频」——YouTube 播放器按钮不响应合成点击、
// #movie_player 的 nextVideo() 等 API 已失效，切换视频请回完整界面操作；
// 视频播完 YouTube 会自动连播，迷你模式下播放不中断
