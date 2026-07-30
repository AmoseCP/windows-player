/** 占位封面的矢量音符（播放栏 / 迷你模式共用） */
function NoteIcon({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M9 18V5.5l12-2.2V16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.5" cy="18" r="2.6" fill="currentColor" />
      <circle cx="18.5" cy="16" r="2.6" fill="currentColor" />
    </svg>
  )
}

export default NoteIcon
