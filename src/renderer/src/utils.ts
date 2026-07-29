/** 绝对路径 → localfile:// URL（分段编码，兼容 Windows 反斜杠路径） */
export function localFileUrl(absPath: string): string {
  const encoded = absPath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  return 'localfile://' + (encoded.startsWith('/') ? '' : '/') + encoded
}

export interface LyricLine {
  time: number | null // 秒；null = 无时间戳（纯文本歌词）
  text: string
}

/** 解析 LRC：带时间戳则返回按时间排序的同步歌词，否则按行返回纯文本 */
export function parseLrc(src: string): LyricLine[] {
  const plain: LyricLine[] = []
  const timed: LyricLine[] = []
  for (const raw of src.split(/\r?\n/)) {
    const times = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    if (times.length === 0) {
      if (text) plain.push({ time: null, text }) // [ti:] 等元数据标签行 text 为空，自动跳过
      continue
    }
    if (!text) continue
    for (const m of times) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0
      timed.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text })
    }
  }
  if (timed.length > 0) return timed.sort((a, b) => a.time! - b.time!)
  return plain
}

export interface YouTubeRef {
  videoId: string // 为空表示纯歌单链接
  listId: string | null
}

/** 解析 YouTube 链接：watch?v= / youtu.be / shorts / live / embed / playlist */
export function parseYouTubeUrl(input: string): YouTubeRef | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  if (host !== 'youtube.com' && host !== 'youtu.be') return null
  const listId = url.searchParams.get('list')
  let videoId: string | null = null
  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0] || null
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v')
  } else {
    const m = url.pathname.match(/^\/(shorts|live|embed|v)\/([\w-]+)/)
    if (m) videoId = m[2]
  }
  if (videoId && !/^[\w-]{5,20}$/.test(videoId)) videoId = null
  if (!videoId && !listId) return null
  return { videoId: videoId ?? '', listId }
}

/** 秒 → m:ss */
export function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '-:--'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
