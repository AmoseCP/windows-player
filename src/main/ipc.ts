import { app, ipcMain, dialog, net, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { parseFile } from 'music-metadata'
import iconv from 'iconv-lite'
import { collectAudioFiles, collectAudioFileEntries } from './library'
import { parseTrack, coversDir } from './metadata'
import { loadData, scheduleSave } from './store'
import { searchYouTube } from './youtubeSearch'
import {
  downloadYouTubeAudio,
  extractYouTubeVideoId,
  extractYouTubeListId,
  fetchYouTubePlaylist
} from './youtubeDownload'
import { SUPPORTED_EXTENSIONS } from '../shared/types'
import type { AppData, ScanResult, Track } from '../shared/types'

const AUDIO_FILTER = {
  name: '音频文件',
  extensions: SUPPORTED_EXTENSIONS.map((e) => e.slice(1))
}

const BATCH_SIZE = 10 // 分批解析，批间让出事件循环并回报进度

/** 解析 m3u/m3u8：保留文件内顺序，跳过注释与已不存在的文件 */
async function readPlaylistFile(file: string): Promise<{ name: string; paths: string[] } | null> {
  try {
    const buf = await fs.readFile(file)
    let text = buf.toString('utf-8')
    if (text.includes('�')) text = iconv.decode(buf, 'gbk') // 旧版 m3u 常为 GBK
    const base = path.dirname(file)
    const paths: string[] = []
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const abs = path.isAbsolute(line) ? line : path.resolve(base, line)
      try {
        await fs.access(abs)
        paths.push(abs)
      } catch {
        // 文件已不存在，跳过
      }
    }
    return { name: path.basename(file, path.extname(file)), paths }
  } catch {
    return null
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:pickFiles', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [AUDIO_FILTER]
    })
    return canceled ? [] : filePaths
  })

  ipcMain.handle('dialog:pickFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return canceled ? [] : filePaths
  })

  ipcMain.handle('dialog:pickMusicFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择音乐文件夹',
      properties: ['openDirectory']
    })
    return canceled ? null : (filePaths[0] ?? null)
  })

  /**
   * 重新扫描登记的音乐文件夹：
   * - 新文件入库；已忽略（曾手动删除）的路径不再加回
   * - 根目录下已消失的曲目：先按文件大小尝试匹配到新出现的文件（移动/改名），
   *   匹配不上才标记缺失，避免歌单引用断链
   */
  ipcMain.handle(
    'library:scan',
    async (
      event,
      folders: string[],
      known: { id: string; path: string; size?: number }[],
      ignored: string[]
    ): Promise<ScanResult> => {
      const roots = (folders ?? []).filter((f) => typeof f === 'string' && f)
      if (roots.length === 0) return { added: [], relocated: [], missingIds: [], scanned: 0 }

      const entries = await collectAudioFileEntries(roots)
      const foundPaths = new Set(entries.map((e) => e.path))
      const knownByPath = new Map(known.map((k) => [k.path, k]))
      const ignoredSet = new Set(ignored ?? [])

      const isUnderRoots = (p: string): boolean =>
        roots.some((r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep))

      // 根目录下、但扫描时已找不到的曲目 —— 可能被移动/改名，也可能真的没了
      const vanished = known.filter((k) => isUnderRoots(k.path) && !foundPaths.has(k.path))
      // 库里没有的新文件（排除手动删除过的）
      const fresh = entries.filter((e) => !knownByPath.has(e.path) && !ignoredSet.has(e.path))

      // 按文件大小把新文件匹配回消失的曲目；同尺寸多个候选时优先同文件名
      const bySize = new Map<number, typeof vanished>()
      for (const v of vanished) {
        if (typeof v.size !== 'number') continue
        const list = bySize.get(v.size) ?? []
        list.push(v)
        bySize.set(v.size, list)
      }
      const relocated: { id: string; path: string }[] = []
      const relocatedIds = new Set<string>()
      const remaining: typeof fresh = []
      for (const f of fresh) {
        const candidates = (bySize.get(f.size) ?? []).filter((c) => !relocatedIds.has(c.id))
        if (candidates.length === 0) {
          remaining.push(f)
          continue
        }
        const sameName = candidates.find((c) => path.basename(c.path) === path.basename(f.path))
        const target = sameName ?? candidates[0]
        relocated.push({ id: target.id, path: f.path })
        relocatedIds.add(target.id)
      }

      // 剩余新文件分批解析，复用导入进度事件
      const added: Track[] = []
      for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
        const batch = remaining.slice(i, i + BATCH_SIZE)
        added.push(...(await Promise.all(batch.map((e) => parseTrack(e.path)))))
        if (!event.sender.isDestroyed()) {
          event.sender.send('import:progress', {
            done: Math.min(i + BATCH_SIZE, remaining.length),
            total: remaining.length
          })
        }
      }

      return {
        added,
        relocated,
        missingIds: vanished.filter((v) => !relocatedIds.has(v.id)).map((v) => v.id),
        scanned: entries.length
      }
    }
  )

  ipcMain.handle('app:coversDir', () => coversDir())

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('app:platform', () => process.platform)

  // 在系统文件管理器中定位歌曲文件
  ipcMain.handle('shell:reveal', (_e, filePath: string) => {
    if (typeof filePath === 'string' && filePath) shell.showItemInFolder(filePath)
  })

  // 清理不再被任何曲目引用的封面缓存（封面按内容 hash 共享，需整体做引用计数）
  ipcMain.handle('covers:gc', async (_e, usedFiles: string[]) => {
    try {
      const used = new Set(Array.isArray(usedFiles) ? usedFiles : [])
      const dir = coversDir()
      const files = await fs.readdir(dir).catch(() => [] as string[])
      let removed = 0
      for (const f of files) {
        if (!used.has(f)) {
          await fs.rm(path.join(dir, f), { force: true })
          removed++
        }
      }
      return removed
    } catch {
      return 0
    }
  })

  ipcMain.handle('youtube:search', async (_e, query: string) => {
    try {
      return await searchYouTube(query)
    } catch {
      return []
    }
  })

  // YouTube 音频下载：下到「音乐/应用名」目录并解析入库；进度通过
  // youtube:downloadProgress 推送（按 videoId 区分，允许多个视频并行下载）
  const activeDownloads = new Set<string>()
  ipcMain.handle(
    'youtube:download',
    async (
      event,
      url: string,
      meta?: { title?: string; artist?: string }
    ): Promise<Track | { error: string }> => {
      const videoId = extractYouTubeVideoId(String(url))
      if (!videoId) return { error: '不是有效的 YouTube 视频链接' }
      if (activeDownloads.has(videoId)) return { error: '该视频正在下载中' }
      activeDownloads.add(videoId)
      try {
        const dir = path.join(app.getPath('music'), 'Bethel Church Audio Player')
        await fs.mkdir(dir, { recursive: true })
        const result = await downloadYouTubeAudio(videoId, dir, (phase, percent) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('youtube:downloadProgress', { videoId, phase, percent })
          }
        })
        if ('error' in result) return result
        const track = await parseTrack(result.file)
        // YouTube 音频无内嵌标签，优先用调用方传来的视频标题/频道名
        if (typeof meta?.title === 'string' && meta.title) track.title = meta.title
        if (typeof meta?.artist === 'string' && meta.artist) track.artist = meta.artist
        return track
      } finally {
        activeDownloads.delete(videoId)
      }
    }
  )

  // 解析歌单为视频列表（不下载）；首次使用时组件下载进度以 videoId=listId 推送
  ipcMain.handle('youtube:playlist', async (event, url: string) => {
    const listId = extractYouTubeListId(String(url))
    if (!listId) return { error: '链接中没有歌单（list=）参数' }
    return fetchYouTubePlaylist(listId, (phase, percent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('youtube:downloadProgress', { videoId: listId, phase, percent })
      }
    })
  })

  // 通过 oEmbed 取视频标题（无需 API key），失败返回 null
  ipcMain.handle('youtube:title', async (_e, videoUrl: string) => {
    try {
      const res = await net.fetch(
        'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(videoUrl)
      )
      if (!res.ok) return null
      const data = (await res.json()) as { title?: unknown }
      return typeof data.title === 'string' ? data.title : null
    } catch {
      return null
    }
  })

  ipcMain.handle('data:load', () => loadData())

  ipcMain.on('data:save', (_e, data: AppData) => scheduleSave(data))

  // 播放前/出错时校验源文件是否仍存在
  ipcMain.handle('track:checkExists', async (_e, filePath: string) => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  // 歌单导出为标准 m3u8（相对/绝对路径均按绝对路径写，便于跨播放器使用）
  ipcMain.handle(
    'playlist:export',
    async (_e, name: string, entries: { path: string; title: string; duration: number }[]) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: '导出歌单',
        defaultPath: `${name}.m3u8`,
        filters: [{ name: '播放列表', extensions: ['m3u8', 'm3u'] }]
      })
      if (canceled || !filePath) return false
      const lines = ['#EXTM3U', `#PLAYLIST:${name}`]
      for (const t of entries) {
        lines.push(`#EXTINF:${Math.round(t.duration)},${t.title}`)
        lines.push(t.path)
      }
      await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8')
      return true
    }
  )

  ipcMain.handle('playlist:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入歌单',
      properties: ['openFile'],
      filters: [{ name: '播放列表', extensions: ['m3u8', 'm3u'] }]
    })
    if (canceled || !filePaths[0]) return null
    return readPlaylistFile(filePaths[0])
  })

  ipcMain.handle('playlist:read', async (_e, file: string) => {
    if (typeof file !== 'string' || !file) return null
    return readPlaylistFile(file)
  })

  /**
   * 从直接的音频链接下载到「音乐/应用名」目录并解析入库。
   * 只接受 http(s) 且响应为音频类型（或音频扩展名），不做任何流媒体站点的解析。
   */
  ipcMain.handle('import:fromUrl', async (_e, url: string): Promise<Track | { error: string }> => {
    let parsed: URL
    try {
      parsed = new URL(String(url))
    } catch {
      return { error: '链接格式不正确' }
    }
    if (!/^https?:$/.test(parsed.protocol)) return { error: '只支持 http/https 链接' }

    let res: Response
    try {
      res = await net.fetch(parsed.toString(), { signal: AbortSignal.timeout(60_000) })
    } catch {
      return { error: '无法连接该链接' }
    }
    if (!res.ok) return { error: `下载失败（HTTP ${res.status}）` }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    const urlName = decodeURIComponent(path.basename(parsed.pathname)) || 'audio'
    const urlExt = path.extname(urlName).toLowerCase()
    const isAudio =
      contentType.startsWith('audio/') ||
      contentType === 'application/ogg' ||
      (SUPPORTED_EXTENSIONS as readonly string[]).includes(urlExt)
    if (!isAudio) {
      return { error: '该链接不是直接的音频文件（需指向 mp3/m4a 等音频本身）' }
    }
    const MAX_DOWNLOAD = 500 * 1024 * 1024
    const size = Number(res.headers.get('content-length') ?? 0)
    if (size > MAX_DOWNLOAD) return { error: '文件过大（超过 500MB）' }

    // 扩展名优先取链接自带的，其次按 Content-Type 推断
    const extFromType = contentType.includes('mpeg')
      ? '.mp3'
      : contentType.includes('mp4') || contentType.includes('m4a')
        ? '.m4a'
        : contentType.includes('flac')
          ? '.flac'
          : contentType.includes('wav')
            ? '.wav'
            : contentType.includes('ogg')
              ? '.ogg'
              : contentType.includes('aac')
                ? '.aac'
                : '.mp3'
    const ext = (SUPPORTED_EXTENSIONS as readonly string[]).includes(urlExt) ? urlExt : extFromType
    const base = path.basename(urlName, urlExt).replace(/[\\/:*?"<>|]/g, '_') || 'audio'

    const dir = path.join(app.getPath('music'), 'Bethel Church Audio Player')
    await fs.mkdir(dir, { recursive: true })
    let dest = path.join(dir, base + ext)
    for (let i = 2; ; i++) {
      try {
        await fs.access(dest)
        dest = path.join(dir, `${base} (${i})${ext}`) // 重名则自动加序号
      } catch {
        break
      }
    }

    // 流式写盘：大文件不占内存；边下边计数，服务器不报 content-length 时上限依然生效
    try {
      if (!res.body) throw new Error('empty body')
      const reader = res.body.getReader()
      const out = await fs.open(dest, 'w')
      let received = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.length
          if (received > MAX_DOWNLOAD) {
            await reader.cancel()
            throw new Error('too-large')
          }
          await out.write(value)
        }
      } finally {
        await out.close()
      }
    } catch (err) {
      await fs.rm(dest, { force: true }).catch(() => {})
      return {
        error:
          err instanceof Error && err.message === 'too-large'
            ? '文件过大（超过 500MB）'
            : '写入文件失败'
      }
    }
    return parseTrack(dest)
  })

  // 主题背景：选择图片并复制到 userData/theme，返回目标绝对路径
  ipcMain.handle('theme:pickImage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }]
    })
    if (canceled || !filePaths[0]) return null
    const src = filePaths[0]
    const dir = path.join(app.getPath('userData'), 'theme')
    await fs.mkdir(dir, { recursive: true })
    const dest = path.join(dir, 'background' + path.extname(src).toLowerCase())
    // 先复制到临时文件，成功后才替换旧背景 —— 否则复制失败会让用户既丢背景又没新图
    const tmp = dest + '.tmp'
    await fs.copyFile(src, tmp)
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith('background.') && f !== path.basename(tmp)) {
        await fs.rm(path.join(dir, f), { force: true })
      }
    }
    await fs.rename(tmp, dest)
    return dest
  })

  // 歌词：同名 .lrc 文件优先（UTF-8/GBK 自动识别），其次音频元数据内嵌歌词
  ipcMain.handle('lyrics:get', async (_e, trackPath: string) => {
    const base = trackPath.replace(/\.[^.]+$/, '')
    for (const ext of ['.lrc', '.LRC', '.Lrc']) {
      try {
        const buf = await fs.readFile(base + ext)
        let content = buf.toString('utf-8')
        if (content.includes('�')) content = iconv.decode(buf, 'gbk')
        return { content }
      } catch {
        // 该扩展名不存在，试下一个
      }
    }
    try {
      const meta = await parseFile(trackPath, { skipCovers: true })
      const lyr = meta.common.lyrics?.[0]
      if (lyr?.syncText?.length) {
        // 内嵌同步歌词 → 转成 LRC 文本统一处理（时间戳单位毫秒）
        const lines = lyr.syncText
          .filter((s) => s.text)
          .map((s) => {
            const t = (s.timestamp ?? 0) / 1000
            const m = String(Math.floor(t / 60)).padStart(2, '0')
            const sec = (t % 60).toFixed(2).padStart(5, '0')
            return `[${m}:${sec}]${s.text}`
          })
        if (lines.length > 0) return { content: lines.join('\n') }
      }
      if (lyr?.text) return { content: lyr.text }
    } catch {
      // 解析失败视为无歌词
    }
    return null
  })

  // 导入：递归扫描 → 排除库中已有路径 → 分批解析并推送 import:progress
  ipcMain.handle(
    'import:paths',
    async (event, paths: string[], existingPaths: string[]): Promise<Track[]> => {
      const files = await collectAudioFiles(paths)
      const existing = new Set(existingPaths)
      const newFiles = files.filter((f) => !existing.has(f))

      const tracks: Track[] = []
      for (let i = 0; i < newFiles.length; i += BATCH_SIZE) {
        const batch = newFiles.slice(i, i + BATCH_SIZE)
        tracks.push(...(await Promise.all(batch.map(parseTrack))))
        if (!event.sender.isDestroyed()) {
          event.sender.send('import:progress', {
            done: Math.min(i + BATCH_SIZE, newFiles.length),
            total: newFiles.length
          })
        }
      }
      return tracks
    }
  )
}
