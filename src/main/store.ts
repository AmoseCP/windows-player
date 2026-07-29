import { app } from 'electron'
import { promises as fs, writeFileSync, renameSync } from 'fs'
import path from 'path'
import type { AppData } from '../shared/types'

function dataPath(): string {
  return path.join(app.getPath('userData'), 'library.json')
}

/** 启动加载；解析失败时备份坏文件并返回 null（空库启动，不崩溃） */
export async function loadData(): Promise<AppData | null> {
  const file = dataPath()
  let text: string
  try {
    text = await fs.readFile(file, 'utf-8')
  } catch {
    return null // 文件不存在（首次启动）
  }
  try {
    return JSON.parse(text) as AppData
  } catch {
    try {
      await fs.rename(file, `${file}.bak-${Date.now()}`)
    } catch {
      // 备份失败也照常以空库启动
    }
    return null
  }
}

let pending: AppData | null = null
let timer: NodeJS.Timeout | null = null

/** 临时文件 + rename 原子写，避免写入中断损坏数据 */
async function writeNow(): Promise<void> {
  if (!pending) return
  const data = pending
  pending = null
  const file = dataPath()
  try {
    await fs.writeFile(file + '.tmp', JSON.stringify(data), 'utf-8')
    await fs.rename(file + '.tmp', file)
  } catch (err) {
    console.error('保存 library.json 失败:', err)
  }
}

/** 渲染进程每次变更都会调用，主进程 500ms 防抖落盘 */
export function scheduleSave(data: AppData): void {
  pending = data
  if (timer) clearTimeout(timer)
  timer = setTimeout(writeNow, 500)
}

/** 退出前同步 flush 未落盘数据 */
export function flushSaveSync(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!pending) return
  const file = dataPath()
  try {
    writeFileSync(file + '.tmp', JSON.stringify(pending), 'utf-8')
    renameSync(file + '.tmp', file)
  } catch (err) {
    console.error('退出时保存 library.json 失败:', err)
  }
  pending = null
}
