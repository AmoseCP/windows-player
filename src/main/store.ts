import { app } from 'electron'
import { promises as fs, writeFileSync, renameSync } from 'fs'
import path from 'path'
import type { AppData } from '../shared/types'

const MAX_BACKUPS = 3 // 坏文件备份只保留最近几份

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
      const dir = app.getPath('userData')
      const baks = (await fs.readdir(dir)).filter((f) => f.startsWith('library.json.bak-')).sort()
      for (const old of baks.slice(0, Math.max(0, baks.length - MAX_BACKUPS))) {
        await fs.rm(path.join(dir, old), { force: true })
      }
    } catch {
      // 备份失败也照常以空库启动
    }
    return null
  }
}

let pending: AppData | null = null
let timer: NodeJS.Timeout | null = null
let writing: Promise<void> | null = null

/** 临时文件 + rename 原子写，避免写入中断损坏数据；串行化防止并发写踩踏 */
async function writeNow(): Promise<void> {
  if (!pending) return
  // 上一次写入未完成时排队，避免两路同时操作临时文件
  if (writing) {
    await writing.catch(() => {})
  }
  if (!pending) return
  const data = pending
  pending = null
  const file = dataPath()
  // 临时文件名唯一，杜绝与其它写入（含退出时的同步写）互相覆盖
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const mine = (async () => {
    try {
      await fs.writeFile(tmp, JSON.stringify(data), 'utf-8')
      await fs.rename(tmp, file)
    } catch (err) {
      console.error('保存 library.json 失败:', err)
      await fs.rm(tmp, { force: true }).catch(() => {})
    }
  })()
  writing = mine
  await mine
  // 等待期间可能已有新一轮写入接管了 writing，只清理自己的标志
  if (writing === mine) writing = null
}

/** 渲染进程每次变更都会调用，主进程 500ms 防抖落盘 */
export function scheduleSave(data: AppData): void {
  pending = data
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void writeNow(), 500)
}

/** 是否还有未落盘的数据（退出流程据此决定是否需要等待） */
export function hasPendingSave(): boolean {
  return pending !== null || writing !== null
}

/** 退出前同步 flush 未落盘数据 */
export function flushSaveSync(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!pending) return
  const file = dataPath()
  const tmp = `${file}.${process.pid}.exit.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(pending), 'utf-8')
    renameSync(tmp, file)
  } catch (err) {
    console.error('退出时保存 library.json 失败:', err)
  }
  pending = null
}
