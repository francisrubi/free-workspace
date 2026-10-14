import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type MenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean } | 'sep'
type Open = { x: number; y: number; items: MenuItem[] }

/** Returns the rendered menu (or null) and an opener to call from `onContextMenu`. */
export function useContextMenu(): [ReactNode, (e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]) => void] {
  const [menu, setMenu] = useState<Open | null>(null)
  const open = (e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  return [menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />, open]
}

function ContextMenu({ x, y, items, onClose }: Open & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) })
  }, [x, y])

  useEffect(() => {
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', away, true)
    window.addEventListener('wheel', away, true)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', away, true)
      window.removeEventListener('wheel', away, true)
      window.removeEventListener('keydown', esc, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div className="fw-menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={i} className="fw-menu-sep" />
        ) : (
          <button
            key={i}
            className={item.danger ? 'danger' : ''}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
