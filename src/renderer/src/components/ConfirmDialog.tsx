interface ConfirmDialogProps {
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <div className="dialog-overlay" onMouseDown={onCancel}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-message">{message}</div>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button className="btn danger" onClick={onConfirm}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
