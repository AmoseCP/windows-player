import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { extname } from 'path'
import { Readable } from 'stream'

/** 必须在 app ready 前调用：注册 localfile:// 为特权协议（流式 + fetch 可用） */
export function registerLocalFileSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    // corsEnabled: audio 元素以 crossOrigin 模式加载（Web Audio 分析器需要），
    // 协议必须允许 CORS 请求
    { scheme: 'localfile', privileges: { stream: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

function pathFromUrl(url: string): string {
  let p = decodeURIComponent(new URL(url).pathname)
  // Windows 路径形如 /C:/Music/a.mp3，去掉开头的斜杠
  if (process.platform === 'win32') p = p.replace(/^\/+/, '')
  return p
}

function toWebStream(filePath: string, start?: number, end?: number): ReadableStream {
  return Readable.toWeb(
    createReadStream(filePath, start !== undefined ? { start, end } : undefined)
  ) as unknown as ReadableStream
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

function mimeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * localfile:///<绝对路径> → 流式读取本地文件（封面图 + 音频播放）。
 * 手动实现 Range 语义（206 / Content-Range / Accept-Ranges）：
 * Electron 的 file:// 处理器会忽略 Range 头，进度条拖动依赖字节范围寻址。
 */
export function registerLocalFileProtocol(): void {
  protocol.handle('localfile', async (request) => {
    try {
      const filePath = pathFromUrl(request.url)
      // 只服务已知的音频/图片类型：该协议能读全盘文件，
      // 白名单确保即使渲染进程被攻破也无法借它读取任意文件（如密钥、配置）
      if (!(extname(filePath).toLowerCase() in MIME)) return new Response(null, { status: 404 })
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) return new Response(null, { status: 404 })

      const range = request.headers.get('Range')
      const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
      if (m && (m[1] || m[2])) {
        let start: number
        let end: number
        if (m[1]) {
          start = parseInt(m[1], 10)
          end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1
        } else {
          // 后缀范围 bytes=-N：最后 N 字节
          start = Math.max(0, stat.size - parseInt(m[2], 10))
          end = stat.size - 1
        }
        if (start >= stat.size || start > end) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${stat.size}` }
          })
        }
        return new Response(toWebStream(filePath, start, end), {
          status: 206,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Type': mimeFor(filePath),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': String(end - start + 1),
            // 允许 Web Audio 分析器读取音频数据（audio 元素以 crossOrigin 模式加载）。
            // 该协议只注册在主窗口的 defaultSession，YouTube 内容在独立分区，读不到本地文件
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      return new Response(toWebStream(filePath), {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Type': mimeFor(filePath),
          'Content-Length': String(stat.size),
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
