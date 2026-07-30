import type { DirNode } from './store/library'
import type { Track } from '../../shared/types'

/** 路径统一用正斜杠比较，兼容 Windows 反斜杠 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 判断某文件是否位于目录之下（含目录本身） */
export function isUnderDir(filePath: string, dir: string): boolean {
  const f = normalizePath(filePath)
  const d = normalizePath(dir).replace(/\/+$/, '')
  return f === d || f.startsWith(d + '/')
}

interface MutableNode {
  name: string
  path: string
  children: Map<string, MutableNode>
  direct: number // 直接位于该目录的曲目数
  total: number // 含子目录的曲目总数
}

/**
 * 由曲目路径派生目录树。
 * 只有一个子目录、自身又没有曲目的层级会与子目录合并显示（如 Users/x/Downloads），
 * 避免侧栏出现一长串只能一路点下去的中间目录。
 */
export function buildFolderTree(tracks: Track[]): DirNode[] {
  if (tracks.length === 0) return []
  const root: MutableNode = { name: '', path: '', children: new Map(), direct: 0, total: 0 }

  for (const t of tracks) {
    const norm = normalizePath(t.path)
    const dir = norm.slice(0, norm.lastIndexOf('/'))
    const segments = dir.split('/').filter(Boolean)
    let node = root
    let acc = ''
    node.total++
    for (const seg of segments) {
      acc = acc + '/' + seg
      let child = node.children.get(seg)
      if (!child) {
        child = { name: seg, path: acc, children: new Map(), direct: 0, total: 0 }
        node.children.set(seg, child)
      }
      child.total++
      node = child
    }
    node.direct++
  }

  const toNode = (n: MutableNode): DirNode => {
    // 压缩单链：a → b → c 合并显示为 a/b/c，路径取最深一级
    let cur = n
    const names = [n.name]
    while (cur.children.size === 1 && cur.direct === 0) {
      cur = [...cur.children.values()][0]
      names.push(cur.name)
    }
    return {
      name: names.filter(Boolean).join('/'),
      path: cur.path,
      total: cur.total,
      children: [...cur.children.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
        .map(toNode)
    }
  }

  return [...root.children.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .map(toNode)
}
