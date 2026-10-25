export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0"
  const rounded = Math.round(n * 100) / 100
  return String(rounded)
}

export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "0"
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs >= 1_000_000_000) return `${sign}${trim(abs / 1_000_000_000)}B`
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}M`
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}k`
  return fmtNum(n)
}

function trim(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return String(rounded)
}

export function normalizeLabel(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase()
}
