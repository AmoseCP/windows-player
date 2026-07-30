import { app, ipcMain, dialog, net, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { parseFile } from 'music-metadata'
import iconv from 'iconv-lite'
import { collectAudioFiles } from './library'
import { parseTrack, coversDir } from './metadata'
import { loadData, scheduleSave } from './store'
import { searchYouTube } from './youtubeSearch'
import { SUPPORTED_EXTENSIONS } from '../shared/types'
import type { AppData, Track } from '../shared/types'

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
