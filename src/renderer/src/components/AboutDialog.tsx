import { useEffect, useState } from 'react'
import { SUPPORTED_EXTENSIONS } from '../../../shared/types'
import NoteIcon from './NoteIcon'

interface AboutDialogProps {
  onClose: () => void
}

// 音频格式取自共享常量，新增支持的格式时说明会自动同步
const AUDIO_FORMATS = SUPPORTED_EXTENSIONS.join('  ')
const PLAYLIST_FORMATS = '.m3u  .m3u8'
const LYRIC_FORMATS = '.lrc（UTF-8 / GBK）'
const IMAGE_FORMATS = '.jpg  .jpeg  .png  .webp  .gif  .bmp'

function AboutDialog({ onClose }: AboutDialogProps): React.JSX.Element {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.getAppVersion().then(setVersion)
  }, [])

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog about-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="about-logo">
          <NoteIcon size={26} />
        </div>
        <div className="dialog-title">伯特利教会音乐播放器</div>
        <div className="about-subtitle">Bethel Church Audio Player</div>
        <div className="about-rows">
          <div className="about-row">
            <span className="about-label">版本</span>
            <span>{version ? `v${version}` : '…'}</span>
          </div>
          <div className="about-row">
            <span className="about-label">开发者</span>
            <span>Amose Ding</span>
          </div>
          <div className="about-row">
            <span className="about-label">联系</span>
            <span>Telegram @Dingjin2025</span>
          </div>
        </div>

        <div className="about-section">
          <div className="about-section-title">支持的文件格式</div>
          <div className="about-format">
            <span className="about-format-label">音频</span>
            <span className="about-format-value">{AUDIO_FORMATS}</span>
          </div>
          <div className="about-format">
            <span className="about-format-label">歌单</span>
            <span className="about-format-value">{PLAYLIST_FORMATS}</span>
          </div>
          <div className="about-format">
            <span className="about-format-label">歌词</span>
            <span className="about-format-value">{LYRIC_FORMATS}</span>
          </div>
          <div className="about-format">
            <span className="about-format-label">背景图</span>
            <span className="about-format-value">{IMAGE_FORMATS}</span>
          </div>
          <div className="about-format-note">
            .mp4 按纯音频播放，不显示画面；.wma 可导入，若系统解码器不支持会提示并自动跳过。
            歌词文件需与音频同目录且同名（也支持读取音频内嵌歌词）。
          </div>
        </div>

        <div className="dialog-actions about-actions">
          <button className="btn" onClick={onClose}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

export default AboutDialog
