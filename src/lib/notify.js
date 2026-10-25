// Small UI helpers shared by screens (kept out of component files for fast refresh).

export function toast(message, ms = 2600) {
  dispatchEvent(new CustomEvent('kinshot:toast', { detail: { message, ms } }))
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.append(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  toast('คัดลอกแล้ว')
}

export const fmtBytes = (n) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`
