import { useEffect, useState } from 'react'

interface AboutDialogProps {
  onClose: () => void
}

function AboutDialog({ onClose }: AboutDialogProps): React.JSX.Element {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.getAppVersion().then(setVersion)
  }, [])

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog about-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="about-logo">♪</div>
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
