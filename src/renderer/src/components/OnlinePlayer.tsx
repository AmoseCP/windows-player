import { useEffect, useRef, useState } from 'react'
import { usePlayer } from '../store/player'
import type { OnlineTab } from '../store/player'
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

interface WebviewEvent extends Event {
  url?: string
  title?: string
  isMainFrame?: boolean
}

interface WebviewElement extends HTMLElement {
  setAudioMuted?: (muted: boolean) => void
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>
}

/** 单个标签的 webview：src 只在挂载时设置，导航/标题变化回写 store */
function TabView({ tab, active }: { tab: OnlineTab; active: boolean }): React.JSX.Element {
  const ref = useRef<WebviewElement | null>(null)
  // webview 的 src 属性变化会触发重新加载，因此只在挂载时取一次；
  // 用 currentUrl 以便重开面板后回到标签内实际浏览到的位置
  const [initialSrc] = useState(tab.currentUrl || tab.url)
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)

  // 播放栏的音量/静音同步到在线标签：静音用原生 API，音量注入页面设置媒体元素。
  // 非当前标签一律静音，避免多个标签同时出声
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (): void => {
      try {
        el.setAudioMuted?.(muted || !active)
        el.executeJavaScript?.(
          `document.querySelectorAll('video,audio').forEach(m => { m.volume = ${volume} })`
        )?.catch(() => {})
      } catch {
        // webview 尚未挂载完成，等加载/导航事件再应用
      }
    }
    apply()
    el.addEventListener('did-finish-load', apply)
    // YouTube 是单页应用，站内跳转不触发 did-finish-load，新的 video 元素音量会回到 100%
    el.addEventListener('did-navigate-in-page', apply)
    return () => {
      el.removeEventListener('did-finish-load', apply)
      el.removeEventListener('did-navigate-in-page', apply)
    }
  }, [volume, muted, active])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onTitle = (e: Event): void => {
      const title = (e as WebviewEvent).title
      if (title) usePlayer.getState().updateOnlineTab(tab.id, { title })
    }
    const onNav = (e: Event): void => {
      const ev = e as WebviewEvent
      if (ev.url && ev.isMainFrame !== false) {
        usePlayer.getState().updateOnlineTab(tab.id, { currentUrl: ev.url })
      }
    }
    el.addEventListener('page-title-updated', onTitle)
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    return () => {
      el.removeEventListener('page-title-updated', onTitle)
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
    }
  }, [tab.id])

  return (
    <webview
      ref={(node) => {
        ref.current = node as WebviewElement | null
      }}
      className={`online-frame${active ? '' : ' inactive'}`}
      src={initialSrc}
    />
  )
}

/** 在线播放面板：多标签浏览 YouTube；粘贴链接/搜索/历史双击都会开新标签 */
function OnlinePlayer(): React.JSX.Element {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<YouTubeSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const history = useLibrary((s) => s.youtubeHistory)
  const tabs = usePlayer((s) => s.onlineTabs)
  const activeTabId = usePlayer((s) => s.activeTabId)
  const inputIsUrl = parseYouTubeUrl(input) !== null
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const startPlay = (ref: YouTubeRef, url: string, knownTitle?: string): void => {
    usePlayer.getState().openOnlineTab(url, knownTitle)
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
        {activeTab && (
          <button
            className="btn"
            title="在独立的大窗口中播放当前标签内容"
            onClick={() => window.api.openYouTubeWindow(activeTab.currentUrl || activeTab.url)}
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
      <div className="online-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`online-tab${tab.id === activeTabId ? ' active' : ''}`}
            title={tab.currentUrl || tab.url}
            onClick={() => usePlayer.getState().setActiveOnlineTab(tab.id)}
          >
            <span className="online-tab-title">{tab.title}</span>
            <button
              className="online-tab-close"
              title="关闭标签"
              onClick={(e) => {
                e.stopPropagation()
                usePlayer.getState().closeOnlineTab(tab.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="online-tab-add"
          title="新建标签（打开 YouTube 首页）"
          onClick={() => usePlayer.getState().openOnlineTab('https://www.youtube.com', 'YouTube')}
        >
          ＋
        </button>
      </div>
      <div className="online-body">
        {tabs.length > 0 ? (
          tabs.map((tab) => <TabView key={tab.id} tab={tab} active={tab.id === activeTabId} />)
        ) : (
          <div className="online-hint">
            <div>粘贴 YouTube 链接直接播放，或输入关键词搜索</div>
            <div className="online-hint-sub">
              需要联网；每次播放会打开一个新标签，「＋」可新建标签自由浏览。 「登录 YouTube」后
              Premium 会员免广告。
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
