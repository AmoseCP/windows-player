import { app, ipcMain, dialog, net } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { parseFile } from 'music-metadata'
import iconv from 'iconv-lite'
import { collectAudioFiles } from './library'
import { parseTrack, coversDir } from './metadata'
import { loadData, scheduleSave } from './store'
import { SUPPORTED_EXTENSIONS } from '../shared/types'
import type { AppData, Track } from '../shared/types'

const AUDIO_FILTER = {
  name: '音频文件',
  extensions: SUPPORTED_EXTENSIONS.map((e) => e.slice(1))
}

const BATCH_SIZE = 10 // 分批解析，批间让出事件循环并回报进度

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
    // 清掉旧背景，避免不同扩展名残留
    for (const f of await fs.readdir(dir)) {
      if (f.startsWith('background.')) await fs.rm(path.join(dir, f), { force: true })
    }
    const dest = path.join(dir, 'background' + path.extname(src).toLowerCase())
    await fs.copyFile(src, dest)
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
