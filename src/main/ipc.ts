import { ipcMain, dialog } from 'electron'
import { promises as fs } from 'fs'
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
