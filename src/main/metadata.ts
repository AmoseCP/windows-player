import { parseFile } from 'music-metadata'
import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { app } from 'electron'
import type { Track } from '../shared/types'

export function coversDir(): string {
  return path.join(app.getPath('userData'), 'covers')
}

/** 封面按内容 hash 存文件，同图复用；失败返回 null（不影响导入） */
async function saveCover(data: Uint8Array, mimeFormat: string): Promise<string | null> {
  try {
    const hash = createHash('sha1').update(data).digest('hex')
    const ext = mimeFormat.includes('png') ? '.png' : '.jpg'
    const fileName = hash + ext
    const filePath = path.join(coversDir(), fileName)
    await fs.mkdir(coversDir(), { recursive: true })
    try {
      await fs.access(filePath)
    } catch {
      await fs.writeFile(filePath, data)
    }
    return fileName
  } catch {
    return null
  }
}

/** 解析单个文件的元数据；任何失败都回退为文件名标题，不抛出 */
export async function parseTrack(filePath: string): Promise<Track> {
  const track: Track = {
    id: randomUUID(),
    path: filePath,
    title: path.basename(filePath, path.extname(filePath)),
    artist: '未知艺术家',
    album: '未知专辑',
    duration: 0,
    coverFile: null,
    addedAt: Date.now()
  }
  try {
    const meta = await parseFile(filePath, { duration: true })
    if (meta.common.title) track.title = meta.common.title
    if (meta.common.artist) track.artist = meta.common.artist
    if (meta.common.album) track.album = meta.common.album
    if (meta.format.duration) track.duration = meta.format.duration
    const pic = meta.common.picture?.[0]
    if (pic) {
      track.coverFile = await saveCover(pic.data, pic.format || '')
    }
  } catch {
    // 解析失败：保留文件名作标题，继续导入
  }
  return track
}
