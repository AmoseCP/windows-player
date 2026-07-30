import { promises as fs } from 'fs'
import path from 'path'
import { SUPPORTED_EXTENSIONS } from '../shared/types'

const MAX_DEPTH = 24 // 目录递归深度上限
const MAX_FILES = 20000 // 单次导入的文件数上限，避免误选根目录时无限扫描

function isSupportedAudio(filePath: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(path.extname(filePath).toLowerCase())
}

export interface AudioFileEntry {
  path: string
  size: number
}

/** 只需要路径时的便捷封装 */
export async function collectAudioFiles(paths: string[]): Promise<string[]> {
  return (await collectAudioFileEntries(paths)).map((e) => e.path)
}

/**
 * 把文件/文件夹混合路径列表展开为受支持的音频文件列表（含文件大小）。
 * 用 lstat 跳过符号链接、按 inode 去重并限制深度 —— 否则指向上层目录的软链
 * 会形成环，产生海量重复路径并挂死导入。
 */
export async function collectAudioFileEntries(paths: string[]): Promise<AudioFileEntry[]> {
  const result: AudioFileEntry[] = []
  const seenPaths = new Set<string>()
  const seenDirs = new Set<string>() // `dev:ino`，防目录环

  async function walk(p: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || result.length >= MAX_FILES) return
    let stat
    try {
      stat = await fs.lstat(p) // 不跟随符号链接
    } catch {
      return // 路径不存在或不可读，跳过
    }
    if (stat.isSymbolicLink()) return // 软链一律跳过，避免环与重复
    if (stat.isDirectory()) {
      const key = `${stat.dev}:${stat.ino}`
      if (seenDirs.has(key)) return
      seenDirs.add(key)
      let entries: string[]
      try {
        entries = await fs.readdir(p)
      } catch {
        return
      }
      for (const name of entries) {
        await walk(path.join(p, name), depth + 1)
      }
    } else if (stat.isFile() && isSupportedAudio(p) && !seenPaths.has(p)) {
      seenPaths.add(p)
      result.push({ path: p, size: stat.size })
    }
  }

  for (const p of paths) {
    // 顶层由用户显式选择：若本身是软链则解析一次，指向目录也照常扫描
    let entry = p
    try {
      const st = await fs.lstat(p)
      if (st.isSymbolicLink()) entry = await fs.realpath(p)
    } catch {
      continue
    }
    await walk(entry, 0)
  }
  return result
}
