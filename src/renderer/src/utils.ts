/** 绝对路径 → localfile:// URL（分段编码，兼容 Windows 反斜杠路径） */
export function localFileUrl(absPath: string): string {
  const encoded = absPath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  return 'localfile://' + (encoded.startsWith('/') ? '' : '/') + encoded
}

/** 秒 → m:ss */
export function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '-:--'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
