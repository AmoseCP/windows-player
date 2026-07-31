import { useEffect, useRef, useState } from 'react'
import { useLibrary } from '../store/library'
import { usePlayer } from '../store/player'
import { parseYouTubeUrl, formatDuration } from '../utils'
import type { YouTubePlaylistEntry } from '../../../shared/types'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  url: string
  onClose: () => void
}

/** YouTube 歌单批量下载：解析视频列表 → 勾选（默认全选）→ 逐首下载入库 */
function PlaylistDownloadDialog({ url, onClose }: Props): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [entries, setEntries] = useState<YouTubePlaylistEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Record<string, string>>({})
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [parseNote, setParseNote] = useState('')
  // 待确认移除的任务（非 null 时显示确认框）
  const [removeTarget, setRemoveTarget] = useState<YouTubePlaylistEntry | null>(null)
  const stopRef = useRef(false)
  const listId = parseYouTubeUrl(url)?.listId ?? ''

  useEffect(() => {
    let alive = true
    window.api.parseYouTubePlaylist(url).then((r) => {
      if (!alive) return
      if ('error' in r) {
        setError(r.error)
        return
      }
      // 同一视频可能在歌单里出现多次，按 videoId 去重
      const seen = new Set<string>()
      const list: YouTubePlaylistEntry[] = []
      for (const e of r.entries) {
        if (!seen.has(e.videoId)) {
          seen.add(e.videoId)
          list.push(e)
        }
      }
      // 已在库中的（文件名含 [videoId]）默认不勾选，避免重复下载
      const paths = Object.values(useLibrary.getState().tracks).map((t) => t.path)
      const inLib = new Set(
        list.filter((e) => paths.some((p) => p.includes(`[${e.videoId}]`))).map((e) => e.videoId)
      )
      setTitle(r.title)
      setEntries(list)
      setInLibrary(inLib)
      setChecked(new Set(list.filter((e) => !inLib.has(e.videoId)).map((e) => e.videoId)))
    })
    return () => {
      alive = false
    }
  }, [url])

  // 进度：videoId=listId 的 component 事件是解析前的组件下载，其余按曲目更新
  useEffect(() => {
    return window.api.onYouTubeDownloadProgress((p) => {
      if (p.videoId === listId) {
        setParseNote(`（正在下载组件 ${p.percent}%）`)
      } else {
        setStatus((s) =>
          p.videoId in s
            ? {
                ...s,
                [p.videoId]: p.phase === 'component' ? `组件 ${p.percent}%` : `${p.percent}%`
              }
            : s
        )
      }
    })
  }, [listId])

  const toggle = (videoId: string): void => {
    setChecked((c) => {
      const next = new Set(c)
      if (next.has(videoId)) next.delete(videoId)
      else next.add(videoId)
      return next
    })
  }

  const removeEntry = (videoId: string): void => {
    setEntries((list) => (list ? list.filter((e) => e.videoId !== videoId) : list))
    setChecked((c) => {
      const next = new Set(c)
      next.delete(videoId)
      return next
    })
    setFailedIds((f) => {
      const next = new Set(f)
      next.delete(videoId)
      return next
    })
    setRemoveTarget(null)
  }

  const toggleAll = (): void => {
    if (!entries) return
    setChecked((c) =>
      c.size === entries.length ? new Set() : new Set(entries.map((e) => e.videoId))
    )
  }

  // only 不传时下载勾选的曲目；「重试失败」传入失败集合，绕过 setChecked 的异步更新
  const start = async (only?: Set<string>): Promise<void> => {
    if (!entries || running) return
    const sel = only ?? checked
    const targets = entries.filter((e) => sel.has(e.videoId))
    if (targets.length === 0) return
    setRunning(true)
    stopRef.current = false
    let ok = 0
    let failed = 0
    for (const e of targets) {
      if (stopRef.current) break
      setStatus((s) => ({ ...s, [e.videoId]: '…' }))
      try {
        const result = await window.api.downloadYouTubeAudio(
          `https://www.youtube.com/watch?v=${e.videoId}`,
          { title: e.title, artist: e.channel }
        )
        if ('error' in result) {
          failed++
          setStatus((s) => ({ ...s, [e.videoId]: `失败：${result.error.slice(0, 60)}` }))
          setFailedIds((f) => new Set(f).add(e.videoId))
        } else {
          useLibrary.getState().addDownloadedTrack(result)
          ok++
          setStatus((s) => ({ ...s, [e.videoId]: '✓ 完成' }))
          // 成功的取消勾选并标记在库，再次点「开始下载」只补漏失败的
          setInLibrary((l) => new Set(l).add(e.videoId))
          setChecked((c) => {
            const next = new Set(c)
            next.delete(e.videoId)
            return next
          })
          setFailedIds((f) => {
            if (!f.has(e.videoId)) return f
            const next = new Set(f)
            next.delete(e.videoId)
            return next
          })
        }
      } catch {
        failed++
        setStatus((s) => ({ ...s, [e.videoId]: '失败' }))
        setFailedIds((f) => new Set(f).add(e.videoId))
      }
    }
    setRunning(false)
    usePlayer
      .getState()
      .showNotice(
        (stopRef.current ? '歌单下载已停止：' : '歌单下载完成：') +
          `成功 ${ok} 首` +
          (failed > 0 ? `，失败 ${failed} 首` : '')
      )
  }

  return (
    <div className="dialog-overlay" onMouseDown={running ? undefined : onClose}>
      <div className="dialog playlist-dl-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{entries ? `下载歌单：${title}` : '下载歌单'}</div>
        {error ? (
          <div className="url-error">{error}</div>
        ) : entries === null ? (
          <div className="dialog-message">正在解析歌单… {parseNote}</div>
        ) : (
          <>
            <div className="playlist-dl-bar">
              <label className="playlist-dl-item-label">
                <input
                  type="checkbox"
                  checked={checked.size === entries.length}
                  disabled={running}
                  onChange={toggleAll}
                />
                全选
              </label>
              <span className="playlist-dl-count">
                已选 {checked.size} / {entries.length} 首
                {failedIds.size > 0 && (
                  <span className="playlist-dl-failed">失败 {failedIds.size} 首</span>
                )}
              </span>
            </div>
            <div className="playlist-dl-list">
              {entries.map((e) => (
                <label key={e.videoId} className="playlist-dl-item playlist-dl-item-label">
                  <input
                    type="checkbox"
                    checked={checked.has(e.videoId)}
                    disabled={running}
                    onChange={() => toggle(e.videoId)}
                  />
                  <span className="playlist-dl-title" title={e.title}>
                    {e.title}
                  </span>
                  <span className="playlist-dl-meta">
                    {e.duration > 0 ? formatDuration(e.duration) : ''}
                  </span>
                  <span className="playlist-dl-status">
                    {status[e.videoId] ?? (inLibrary.has(e.videoId) ? '已在库中' : '')}
                  </span>
                  <button
                    className="playlist-dl-remove"
                    title="从列表中移除该任务"
                    disabled={running}
                    onClick={(ev) => {
                      // 按钮在 label 内，阻止默认行为避免顺带切换勾选框
                      ev.preventDefault()
                      ev.stopPropagation()
                      setRemoveTarget(e)
                    }}
                  >
                    ✕
                  </button>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="dialog-actions">
          {running ? (
            <button
              className="btn"
              onClick={() => {
                stopRef.current = true
              }}
            >
              停止（完成当前曲目后）
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              关闭
            </button>
          )}
          {failedIds.size > 0 && !running && (
            <button
              className="btn"
              onClick={() => {
                setChecked(new Set(failedIds))
                void start(new Set(failedIds))
              }}
            >
              重试失败（{failedIds.size} 首）
            </button>
          )}
          {entries !== null && (
            <button
              className="btn"
              disabled={running || checked.size === 0}
              onClick={() => void start()}
            >
              {running ? '下载中…' : `开始下载（${checked.size} 首）`}
            </button>
          )}
        </div>
        {removeTarget && (
          <ConfirmDialog
            title="移除下载任务"
            message={`确定从下载列表移除「${removeTarget.title}」吗？`}
            onConfirm={() => removeEntry(removeTarget.videoId)}
            onCancel={() => setRemoveTarget(null)}
          />
        )}
      </div>
    </div>
  )
}

export default PlaylistDownloadDialog
