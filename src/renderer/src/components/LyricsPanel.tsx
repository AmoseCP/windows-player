import { useEffect, useRef, useState } from 'react'
import { usePlayer, currentTrackId } from '../store/player'
import { useLibrary } from '../store/library'
import { audio } from '../hooks/useAudio'
import { getAnalyser } from '../visualizer'
import { parseLrc } from '../utils'
import type { LyricLine } from '../utils'

const BAR_COUNT = 48

/** 无歌词时的频谱律动条：实时读取播放中音频的频率数据绘制 */
function Visualizer(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const analyser = getAnalyser()
    const data = new Uint8Array(analyser.frequencyBinCount)
    const c = canvas.getContext('2d')
    if (!c) return
    const dpr = window.devicePixelRatio || 1

    // 画布尺寸随窗口/侧栏变化重新测量，否则拉伸后条形会模糊变形
    let gradient: CanvasGradient | null = null
    const resize = (): void => {
      canvas.width = Math.max(1, canvas.clientWidth * dpr)
      canvas.height = Math.max(1, canvas.clientHeight * dpr)
      // 跟随当前主题强调色
      const accent =
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f8cff'
      gradient = c.createLinearGradient(0, 0, 0, canvas.height)
      gradient.addColorStop(0, accent)
      gradient.addColorStop(1, accent + '66')
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let raf = 0
    const draw = (): void => {
      analyser.getByteFrequencyData(data)
      const { width, height } = canvas
      c.clearRect(0, 0, width, height)
      if (gradient) c.fillStyle = gradient
      const slot = width / BAR_COUNT
      const barW = slot * 0.55
      for (let i = 0; i < BAR_COUNT; i++) {
        const v = data[i] / 255
        const h = Math.max(3 * dpr, v * height * 0.92)
        const x = i * slot + (slot - barW) / 2
        const y = (height - h) / 2 // 以中线对称，呈波浪感
        c.beginPath()
        c.roundRect(x, y, barW, h, barW / 2)
        c.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="lyrics-visualizer" />
}

/** 歌词面板：覆盖在主区上方；LRC 按时间高亮当前行并自动滚动 */
function LyricsPanel(): React.JSX.Element {
  const trackId = usePlayer((s) => currentTrackId(s))
  const track = useLibrary((s) => (trackId ? s.tracks[trackId] : null))
  // 按路径键控：路径不匹配即视为加载中，切歌无需同步重置状态
  const [loaded, setLoaded] = useState<{ path: string; lines: LyricLine[] } | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)
  const path = track?.path

  useEffect(() => {
    if (!path) return
    let cancelled = false
    window.api.getLyrics(path).then((res) => {
      if (!cancelled) setLoaded({ path, lines: res ? parseLrc(res.content) : [] })
    })
    return () => {
      cancelled = true
    }
  }, [path])

  const lines = path && loaded?.path === path ? loaded.lines : null
  const synced = !!lines?.length && lines[0].time !== null

  // 同步歌词：跟随播放进度更新当前行
  useEffect(() => {
    if (!synced || !lines) return
    const onTime = (): void => {
      const t = audio.currentTime + 0.2 // 少量提前量，视觉上更跟手
      let idx = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].time! <= t) idx = i
        else break
      }
      setActiveIndex(idx)
    }
    const raf = requestAnimationFrame(onTime) // 暂停状态下打开面板也能定位当前行
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('seeked', onTime)
    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('seeked', onTime)
    }
  }, [synced, lines])

  // 当前行滚动到面板中部
  useEffect(() => {
    if (activeIndex < 0) return
    listRef.current
      ?.querySelector(`[data-line="${activeIndex}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIndex])

  return (
    <div className="lyrics-panel">
      <div className="lyrics-header">
        <span className="lyrics-track">{track ? `${track.title} — ${track.artist}` : ''}</span>
        <button
          className="control-btn"
          title="关闭歌词"
          onClick={() => usePlayer.getState().toggleLyrics()}
        >
          ✕
        </button>
      </div>
      <div className="lyrics-body" ref={listRef}>
        {!track ? (
          <div className="lyrics-empty">未在播放</div>
        ) : lines === null ? (
          <div className="lyrics-empty">加载中…</div>
        ) : lines.length === 0 ? (
          <div className="lyrics-empty lyrics-empty-vis">
            <Visualizer />
            <div className="lyrics-empty-hint">暂无歌词（可在音频同目录放置同名 .lrc 文件）</div>
          </div>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              data-line={i}
              className={`lyrics-line${synced && i === activeIndex ? ' active' : ''}${
                synced ? '' : ' static'
              }`}
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default LyricsPanel
