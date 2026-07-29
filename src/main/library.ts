import { promises as fs } from 'fs'
import path from 'path'
import { SUPPORTED_EXTENSIONS } from '../shared/types'

function isSupportedAudio(filePath: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(path.extname(filePath).toLowerCase())
}

/** 把文件/文件夹混合路径列表展开为受支持的音频文件列表（文件夹递归扫描、按路径去重） */
export async function collectAudioFiles(paths: string[]): Promise<string[]> {
  const result: string[] = []
  const seen = new Set<string>()

  async function walk(p: string): Promise<void> {
    let stat
    try {
      stat = await fs.stat(p)
    } catch {
      return // 路径不存在或不可读，跳过
    }
    if (stat.isDirectory()) {
      let entries: string[]
      try {
        entries = await fs.readdir(p)
      } catch {
        return
      }
      for (const name of entries) {
        await walk(path.join(p, name))
      }
    } else if (stat.isFile() && isSupportedAudio(p) && !seen.has(p)) {
      seen.add(p)
      result.push(p)
    }
  }

  for (const p of paths) {
    await walk(p)
  }
  return result
}
