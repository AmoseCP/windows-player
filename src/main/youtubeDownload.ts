import { app, net, session } from 'electron'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

/**
 * YouTube 音频下载：调用 yt-dlp 官方单文件版（首次使用时自动下载到 userData/bin）。
 * 格式只选 m4a/mp4 容器 —— 播放器原生支持，无需再打包 ffmpeg 做转码。
 */

const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'

export type DownloadPhase = 'component' | 'download'

function binaryPath(): string {
  const name =
    process.platform === 'win32'
      ? 'yt-dlp.exe'
      : process.platform === 'darwin'
        ? 'yt-dlp_macos'
        : 'yt-dlp'
  return path.join(app.getPath('userData'), 'bin', name)
}

/** 从各种 YouTube 链接形式中取出 11 位视频 id，取不到返回 null */
export function extractYouTubeVideoId(input: string): string | null {
  try {
    const u = new URL(input)
    const host = u.hostname.replace(/^(www|m|music)\./, '')
    if (host === 'youtu.be') {
      const m = u.pathname.match(/^\/([\w-]{11})(?:$|[/?])/)
      return m ? m[1] : null
    }
    if (host === 'youtube.com') {
      const v = u.searchParams.get('v')
      if (v && /^[\w-]{11}$/.test(v)) return v
      const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})(?:$|[/?])/)
      return m ? m[1] : null
    }
  } catch {
    // 非法 URL
  }
  return null
}

// 并发调用只下载一次二进制；失败时清空以便下次重试
let ensurePromise: Promise<string> | null = null

function ensureYtDlp(onProgress: (percent: number) => void): Promise<string> {
  if (!ensurePromise) {
    ensurePromise = doEnsureYtDlp(onProgress).catch((err) => {
      ensurePromise = null
      throw err
    })
  }
  return ensurePromise
}

async function doEnsureYtDlp(onProgress: (percent: number) => void): Promise<string> {
  const bin = binaryPath()
  try {
    await fs.access(bin)
    return bin
  } catch {
    // 尚未下载过，从 GitHub 获取（约 20–35MB）
  }
  const res = await net.fetch(YTDLP_RELEASE + path.basename(bin), {
    signal: AbortSignal.timeout(300_000)
  })
  if (!res.ok || !res.body) throw new Error(`yt-dlp 下载失败：HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress(Math.round((received / total) * 100))
  }
  await fs.mkdir(path.dirname(bin), { recursive: true })
  // 先写临时文件再改名，避免中断留下损坏的二进制
  const tmp = bin + '.tmp'
  await fs.writeFile(tmp, Buffer.concat(chunks))
  if (process.platform !== 'win32') await fs.chmod(tmp, 0o755)
  try {
    await fs.rename(tmp, bin)
  } catch {
    // Windows 上刚写完的 exe 可能被 Defender 扫描短暂锁住，稍等重试一次
    await new Promise((r) => setTimeout(r, 500))
    await fs.rename(tmp, bin)
  }
  return bin
}

// yt-dlp 是 Python 程序，Windows 上管道输出默认用 ANSI 代码页（如 GBK），
// 中文标题的文件路径会乱码；统一强制 UTF-8，与 macOS/Linux 行为一致
const YTDLP_ENV = { ...process.env, PYTHONIOENCODING: 'utf-8' }

/** 把 YouTube 分区的登录 cookie 导出为 Netscape 格式供 yt-dlp 使用（降低风控拦截概率） */
async function exportYouTubeCookies(): Promise<string | null> {
  try {
    const all = await session.fromPartition('persist:youtube').cookies.get({})
    const relevant = all.filter((c) => /(youtube|google)\.com$/.test(c.domain ?? ''))
    if (relevant.length === 0) return null
    const lines = ['# Netscape HTTP Cookie File']
    for (const c of relevant) {
      const domain = c.domain ?? ''
      lines.push(
        [
          (c.httpOnly ? '#HttpOnly_' : '') + domain,
          domain.startsWith('.') ? 'TRUE' : 'FALSE',
          c.path ?? '/',
          c.secure ? 'TRUE' : 'FALSE',
          Math.floor(c.expirationDate ?? 0),
          c.name,
          c.value
        ].join('\t')
      )
    }
    const file = path.join(app.getPath('userData'), 'bin', 'yt-cookies.txt')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, lines.join('\n') + '\n', 'utf-8')
    return file
  } catch {
    return null
  }
}

/** 从链接中取出歌单 id（list= 参数），取不到返回 null */
export function extractYouTubeListId(input: string): string | null {
  try {
    const u = new URL(input)
    const host = u.hostname.replace(/^(www|m|music)\./, '')
    if (host !== 'youtube.com' && host !== 'youtu.be') return null
    const list = u.searchParams.get('list')
    return list && /^[\w-]{2,64}$/.test(list) ? list : null
  } catch {
    return null
  }
}

export interface PlaylistEntry {
  videoId: string
  title: string
  channel: string
  duration: number // 秒；未知为 0
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 解析歌单为视频列表（--flat-playlist 只取元数据，不下载） */
export async function fetchYouTubePlaylist(
  listId: string,
  onProgress: (phase: DownloadPhase, percent: number) => void
): Promise<{ title: string; entries: PlaylistEntry[] } | { error: string }> {
  let bin: string
  try {
    bin = await ensureYtDlp((p) => onProgress('component', p))
  } catch {
    return { error: '获取下载组件失败（首次使用需联网下载 yt-dlp），请稍后重试' }
  }
  const cookies = await exportYouTubeCookies()
  const args = [
    '--flat-playlist',
    '-J',
    '--no-warnings',
    '--socket-timeout',
    '30',
    ...(cookies ? ['--cookies', cookies] : []),
    `https://www.youtube.com/playlist?list=${listId}`
  ]
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true, env: YTDLP_ENV })
    const out: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => child.kill(), 5 * 60_000)
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ error: '无法启动下载组件' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        const errLine = stderr
          .split('\n')
          .reverse()
          .find((l) => l.includes('ERROR'))
        resolve({
          error: errLine ? errLine.replace(/^ERROR:\s*/, '').slice(0, 200) : '歌单解析失败'
        })
        return
      }
      try {
        const data = JSON.parse(Buffer.concat(out).toString()) as any
        const entries: PlaylistEntry[] = (data?.entries ?? [])
          .filter((e: any) => typeof e?.id === 'string' && /^[\w-]{11}$/.test(e.id))
          .map((e: any) => ({
            videoId: e.id as string,
            title: typeof e.title === 'string' ? e.title : e.id,
            channel:
              typeof e.channel === 'string'
                ? e.channel
                : typeof e.uploader === 'string'
                  ? e.uploader
                  : '',
            duration: typeof e.duration === 'number' ? e.duration : 0
          }))
        if (entries.length === 0) {
          resolve({ error: '歌单为空或无法读取（私享歌单需先登录 YouTube）' })
          return
        }
        resolve({ title: typeof data.title === 'string' ? data.title : '歌单', entries })
      } catch {
        resolve({ error: '歌单解析失败' })
      }
    })
  })
}

/* eslint-enable @typescript-eslint/no-explicit-any */

const PROGRESS_RE = /^\[download\]\s+([\d.]+)%/

/**
 * 下载失败时尝试让 yt-dlp 自更新（YouTube 改版常导致旧版失效）。
 * 用二进制 mtime 限流：距上次更新尝试不足一天则跳过。返回是否执行了更新。
 */
async function trySelfUpdate(bin: string): Promise<boolean> {
  try {
    const stat = await fs.stat(bin)
    if (Date.now() - stat.mtimeMs < 24 * 60 * 60_000) return false
  } catch {
    return false
  }
  const updated = await new Promise<boolean>((resolve) => {
    const child = spawn(bin, ['-U'], { windowsHide: true, env: YTDLP_ENV })
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, 120_000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
  // 已是最新版时 -U 不会重写文件，主动刷新 mtime 以维持一天一次的限流
  const now = new Date()
  await fs.utimes(bin, now, now).catch(() => {})
  return updated
}

/** 清除 yt-dlp 的缓存目录：其中的签名破解结果过期后所有下载都会 403 */
function clearYtDlpCache(bin: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--rm-cache-dir'], { windowsHide: true, env: YTDLP_ENV })
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, 30_000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve()
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** 下载单个视频的音频到 destDir，成功返回最终文件的绝对路径 */
export async function downloadYouTubeAudio(
  videoId: string,
  destDir: string,
  onProgress: (phase: DownloadPhase, percent: number) => void
): Promise<{ file: string } | { error: string }> {
  let bin: string
  try {
    bin = await ensureYtDlp((p) => onProgress('component', p))
  } catch {
    return { error: '获取下载组件失败（首次使用需联网下载 yt-dlp），请稍后重试' }
  }
  const cookies = await exportYouTubeCookies()
  const argsFor = (withCookies: boolean, extractorArgs?: string): string[] => [
    '--no-playlist',
    '--no-warnings',
    '--windows-filenames',
    '--newline',
    '--progress',
    '--socket-timeout',
    '30',
    '-f',
    // 优先 m4a/mp4（无需转码）；部分视频/客户端只提供 webm(opus)，
    // 播放器原生支持，作为兜底避免「Requested format is not available」
    'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best[ext=mp4]/best',
    // 标题截断到 60 字符（[id] 后缀始终保留）：NTFS 整条路径默认限 260 字符、
    // APFS 单文件名限 255 字节（中文 3 字节/字），保证两个平台生成相同且都合法的文件名
    '-o',
    path.join(destDir, '%(title).60s [%(id)s].%(ext)s'),
    '--no-simulate',
    '--print',
    'after_move:filepath',
    ...(extractorArgs ? ['--extractor-args', extractorArgs] : []),
    ...(withCookies && cookies ? ['--cookies', cookies] : []),
    `https://www.youtube.com/watch?v=${videoId}`
  ]
  const run = (
    withCookies: boolean,
    extractorArgs?: string
  ): Promise<{ file: string } | { error: string }> =>
    runYtDlp(bin, argsFor(withCookies, extractorArgs), onProgress)
  const retriable = (e: string): boolean => /403|format is not available/i.test(e)

  let result = await run(true)
  // 403 多为签名缓存过期（过期后所有下载都失败），清缓存后重试一次
  if ('error' in result && result.error.includes('403')) {
    await clearYtDlpCache(bin)
    result = await run(true)
  }
  // 登录 cookie 会让 yt-dlp 弃用部分播放器客户端，缺 PO Token 时表现为
  // 403 或无可用格式；去掉 cookie 再试一次（匿名客户端反而拿得到直链）
  if ('error' in result && cookies && retriable(result.error)) {
    result = await run(false)
  }
  // 默认客户端（android_vr 等）的直链对部分音乐版权视频恒 403，
  // 换一组经验上仍可用的备用客户端再试
  if ('error' in result && retriable(result.error)) {
    result = await run(false, 'youtube:player_client=android_music,web_embedded,tv_simply')
  }
  // 失败可能是 YouTube 改版导致组件过期：自更新成功后重试一次
  if ('error' in result && (await trySelfUpdate(bin))) return run(true)
  return result
}

function runYtDlp(
  bin: string,
  args: string[],
  onProgress: (phase: DownloadPhase, percent: number) => void
): Promise<{ file: string } | { error: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true, env: YTDLP_ENV })
    let file = ''
    let stderr = ''
    let stdoutBuf = ''
    const timer = setTimeout(() => child.kill(), 20 * 60_000) // 卡死兜底

    const handleLine = (line: string): void => {
      const m = line.match(PROGRESS_RE)
      if (m) onProgress('download', Math.min(100, Math.round(parseFloat(m[1]))))
      else if (path.isAbsolute(line.trim())) file = line.trim() // --print 输出的最终路径
    }
    child.stdout.on('data', (d: Buffer) => {
      stdoutBuf += d.toString()
      const lines = stdoutBuf.split('\n')
      stdoutBuf = lines.pop() ?? ''
      lines.forEach(handleLine)
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ error: '无法启动下载组件' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (stdoutBuf) handleLine(stdoutBuf)
      if (code === 0 && file) {
        resolve({ file })
        return
      }
      const errLine = stderr
        .split('\n')
        .reverse()
        .find((l) => l.includes('ERROR'))
      resolve({
        error: errLine
          ? errLine.replace(/^ERROR:\s*/, '').slice(0, 200)
          : `下载失败（退出码 ${code}）`
      })
    })
  })
}
