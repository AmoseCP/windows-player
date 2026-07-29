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

/** 秒 → m:ss */
export function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '-:--'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
