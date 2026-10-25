import { useEffect, useState } from 'react'

export function Toaster() {
  const [t, setT] = useState(null)
  useEffect(() => {
    let timer
    const on = (e) => {
      setT(e.detail.message)
      clearTimeout(timer)
      timer = setTimeout(() => setT(null), e.detail.ms)
    }
    addEventListener('kinshot:toast', on)
    return () => {
      removeEventListener('kinshot:toast', on)
      clearTimeout(timer)
    }
  }, [])
  return t ? (
    <div className="toast" role="status">
      {t}
    </div>
  ) : null
}

export function Modal({ onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

export function Progress({ value, label }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="bar">
        <i style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      </div>
      {label && <div className="small muted">{label}</div>}
    </div>
  )
}

export const BackButton = ({ to = '#/' }) => (
  <a className="btn icon ghost" href={to} aria-label="ย้อนกลับ">
    ←
  </a>
)
