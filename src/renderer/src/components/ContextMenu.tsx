import { useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onClick?: () => void
  danger?: boolean
  submenu?: MenuItem[] // 级联子菜单（添加到歌单）
  disabled?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** 通用右键菜单：全屏遮罩点击/右键即关闭，超出视口时自动翻转 */
function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      x: x + rect.width > window.innerWidth ? Math.max(0, x - rect.width) : x,
      y: y + rect.height > window.innerHeight ? Math.max(0, y - rect.height) : y
    })
  }, [x, y])

  return (
    <div
      className="menu-overlay"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <MenuList items={items} onClose={onClose} />
      </div>
    </div>
  )
}

function MenuList({
  items,
  onClose
}: {
  items: MenuItem[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <>
      {items.map((item, i) => (
        <div
          key={i}
          className={`menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}${
            item.submenu ? ' has-submenu' : ''
          }`}
          onClick={() => {
            if (item.disabled || item.submenu) return
            item.onClick?.()
            onClose()
          }}
        >
          <span className="menu-label">{item.label}</span>
          {item.submenu && (
            <>
              <span className="menu-arrow">▸</span>
              <div className="context-menu submenu">
                {item.submenu.length > 0 ? (
                  <MenuList items={item.submenu} onClose={onClose} />
                ) : (
                  <div className="menu-item disabled">
                    <span className="menu-label">暂无歌单</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </>
  )
}

export default ContextMenu
