import { useState } from 'react'
import { usePlayer } from '../store/player'
import { useLibrary } from '../store/library'
import { parseYouTubeUrl } from '../utils'
import type { YouTubeRef } from '../utils'
import type { YouTubeHistoryItem, YouTubeSearchResult } from '../../../shared/types'

function formatPlayedAt(t: number): string {
  return new Date(t).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** 在线播放面板：粘贴链接直接播放、输入关键词搜索 YouTube，播放记录按时间排列 */
function OnlinePlayer(): React.JSX.Element {
  const [input, setInput] = useState('')
  // 当前播放的原始链接：webview 加载完整观看页，不受嵌入限制
  const [currentUrl, setCurrentUrl] = useState('')
  const [results, setResults] = useState<YouTubeSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const history = useLibrary((s) => s.youtubeHistory)
  const inputIsUrl = parseYouTubeUrl(input) !== null

  const startPlay = (ref: YouTubeRef, url: string, knownTitle?: string): void => {
    setCurrentUrl(url)
    // 开始在线播放时暂停本地播放，避免两路声音
    usePlayer.setState({ playing: false })
    useLibrary.getState().addYouTubeHistory({
      url,
      videoId: ref.videoId,
      listId: ref.listId,
      title: knownTitle ?? null
    })
    if (!knownTitle) {
      // 异步补标题，取不到就继续显示链接
      window.api.getYouTubeTitle(url).then((title) => {
        if (title) useLibrary.getState().setYouTubeTitle(ref.videoId, ref.listId, title)
      })
    }
  }

  const submit = async (): Promise<void> => {
    const text = input.trim()
    if (!text || searching) return
    const ref = parseYouTubeUrl(text)
    if (ref) {
      startPlay(ref, text)
      return
    }
    // 非链接 → 按关键词搜索
    setSearching(true)
    setSearchFailed(false)
    try {
      const found = await window.api.searchYouTube(text)
      setResults(found)
      setSearchFailed(found.length === 0)
    } finally {
      setSearching(false)
    }
  }

  const playResult = (r: YouTubeSearchResult): void => {
    startPlay(
      { videoId: r.videoId, listId: null },
      `https://www.youtube.com/watch?v=${r.videoId}`,
      r.title
    )
  }

  const playFromHistory = (item: YouTubeHistoryItem): void => {
    startPlay({ videoId: item.videoId, listId: item.listId }, item.url)
  }

  return (
    <div className="online-panel">
      <div className="online-header">
        <input
          className="online-input"
          type="text"
          placeholder="粘贴 YouTube 链接直接播放，或输入关键词搜索…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button className="btn" onClick={submit} disabled={searching}>
          {searching ? '搜索中…' : inputIsUrl ? '播放' : '搜索'}
        </button>
        {currentUrl && (
          <button
            className="btn"
            title="在独立的大窗口中播放当前内容"
            onClick={() => window.api.openYouTubeWindow(currentUrl)}
          >
            在窗口中打开
          </button>
        )}
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
      <div className="online-body">
        {currentUrl ? (
          <webview className="online-frame" src={currentUrl} />
        ) : (
          <div className="online-hint">
            <div>粘贴 YouTube 链接直接播放，或输入关键词搜索</div>
            <div className="online-hint-sub">
              需要联网；关闭此面板即停止播放。「登录 YouTube」后 Premium 会员免广告。
            </div>
          </div>
        )}
      </div>
      {results !== null ? (
        <div className="online-history">
          <div className="online-history-title">
            <span>{searchFailed ? '没有找到相关视频' : `搜索结果（${results.length}）`}</span>
            <button className="online-clear" onClick={() => setResults(null)}>
              返回播放记录
            </button>
          </div>
          <div className="online-history-list">
            {results.map((r) => (
              <div
                key={r.videoId}
                className="online-history-item"
                title={r.title}
                onClick={() => playResult(r)}
              >
                {r.thumbnail && <img className="online-thumb" src={r.thumbnail} alt="" />}
                <span className="online-history-name">{r.title}</span>
                <span className="online-result-channel">{r.channel}</span>
                <span className="online-history-time">{r.duration}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        history.length > 0 && (
          <div className="online-history">
            <div className="online-history-title">
              <span>播放记录</span>
            </div>
            <div className="online-history-list">
              {history.map((item) => (
                <div
                  key={`${item.videoId}|${item.listId ?? ''}`}
                  className="online-history-item"
                  title={`双击播放\n${item.url}`}
                  onDoubleClick={() => playFromHistory(item)}
                >
                  <span className="online-history-name">
                    {item.listId && !item.videoId ? '📃 ' : ''}
                    {item.title ?? item.url}
                  </span>
                  <span className="online-history-time">{formatPlayedAt(item.playedAt)}</span>
                  <button
                    className="online-history-remove"
                    title="删除记录"
                    onClick={(e) => {
                      e.stopPropagation()
                      useLibrary.getState().removeYouTubeHistory(item.videoId, item.listId)
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}

export default OnlinePlayer
