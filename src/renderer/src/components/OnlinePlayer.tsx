import { useState } from 'react'
import { usePlayer } from '../store/player'
import { parseYouTubeUrl } from '../utils'
import type { YouTubeRef } from '../utils'

function embedUrl(ref: YouTubeRef): string {
  // 用 www.youtube.com（非 nocookie）以共享登录会话，Premium 账号免广告
  if (ref.videoId) {
    const list = ref.listId ? `&list=${ref.listId}` : ''
    return `https://www.youtube.com/embed/${ref.videoId}?autoplay=1&rel=0${list}`
  }
  return `https://www.youtube.com/embed/videoseries?list=${ref.listId}&autoplay=1`
}

/** 在线播放面板：粘贴 YouTube 链接用官方嵌入播放器播放 */
function OnlinePlayer(): React.JSX.Element {
  const [input, setInput] = useState('')
  const [current, setCurrent] = useState<YouTubeRef | null>(null)
  const [error, setError] = useState(false)

  const play = (): void => {
    const ref = parseYouTubeUrl(input)
    if (!ref) {
      setError(true)
      return
    }
    setError(false)
    setCurrent(ref)
    // 开始在线播放时暂停本地播放，避免两路声音
    usePlayer.setState({ playing: false })
  }

  return (
    <div className="online-panel">
      <div className="online-header">
        <input
          className="online-input"
          type="text"
          placeholder="粘贴 YouTube 视频或歌单链接…"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setError(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') play()
          }}
        />
        <button className="btn" onClick={play}>
          播放
        </button>
        <button
          className="btn"
          title="登录 YouTube 账号（Premium 会员可免广告）"
          onClick={() => window.api.openYouTubeLogin()}
        >
          登录 YouTube
        </button>
        <button
          className="control-btn"
          title="关闭在线播放"
          onClick={() => usePlayer.getState().toggleOnline()}
        >
          ✕
        </button>
      </div>
      {error && <div className="online-error">无法识别的 YouTube 链接</div>}
      <div className="online-body">
        {current ? (
          <iframe
            className="online-frame"
            src={embedUrl(current)}
            title="YouTube 播放器"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="online-hint">
            <div>粘贴 YouTube 链接后点「播放」</div>
            <div className="online-hint-sub">
              支持视频 / 歌单链接（youtube.com、youtu.be）。需要联网；关闭此面板即停止播放。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default OnlinePlayer
