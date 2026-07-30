import { useEffect, useRef } from 'react'
import { usePlayer } from '../store/player'
import { useLibrary } from '../store/library'
import { formatDuration } from '../utils'

/** 播放队列面板：查看/跳转/移出/清空当前队列 */
function QueuePanel(): React.JSX.Element {
  const queue = usePlayer((s) => s.queue)
  const queueIndex = usePlayer((s) => s.queueIndex)
  const tracks = useLibrary((s) => s.tracks)
  const listRef = useRef<HTMLDivElement>(null)

  // 打开时滚动到当前播放项
  useEffect(() => {
    listRef.current
      ?.querySelector('.queue-item.playing')
      ?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [])

  const totalSeconds = queue.reduce((sum, id) => sum + (tracks[id]?.duration ?? 0), 0)

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <span className="side-panel-title">
          播放队列
          {queue.length > 0 && (
            <span className="side-panel-sub">
              {queue.length} 首 · 共 {formatDuration(totalSeconds)}
            </span>
          )}
        </span>
        <div className="side-panel-actions">
          {queue.length > 0 && (
            <button className="btn" onClick={() => usePlayer.getState().clearQueue()}>
              清空
            </button>
          )}
          <button
            className="control-btn"
            title="关闭队列"
            onClick={() => usePlayer.getState().toggleQueue()}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="side-panel-body" ref={listRef}>
        {queue.length === 0 ? (
          <div className="side-panel-empty">队列为空，双击歌曲开始播放</div>
        ) : (
          queue.map((id, i) => {
            const track = tracks[id]
            return (
              <div
                key={`${id}-${i}`}
                className={`queue-item${i === queueIndex ? ' playing' : ''}`}
                title="双击播放"
                onDoubleClick={() => usePlayer.getState().playQueueIndex(i)}
              >
                <span className="queue-index">{i === queueIndex ? '▶' : i + 1}</span>
                <span className="queue-title">{track?.title ?? '(已从音乐库移除)'}</span>
                <span className="queue-artist">{track?.artist ?? ''}</span>
                <span className="queue-duration">{formatDuration(track?.duration ?? 0)}</span>
                <button
                  className="queue-remove"
                  title="移出队列"
                  onClick={(e) => {
                    e.stopPropagation()
                    usePlayer.getState().removeFromQueue(id)
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default QueuePanel
