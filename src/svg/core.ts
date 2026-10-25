import { esc } from "../util.ts"

export { esc }

export const INK = "#8b929c"
export const INK_STRONG = "#aab1bb"
export const GRID = "#6b7280"
export const FRAME = "#565d66"
export const ACCENT = "#4c8de8"
export const POS = "#45b07f"
export const NEG = "#d9636b"
export const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

export const SERIES = [
  "#4c8de8",
  "#45b07f",
  "#e0a63a",
  "#d9636b",
  "#9a7bd8",
  "#4bb3c4",
  "#d67bb1",
  "#8f9aa8",
]

export type Series = { name?: string; values: number[]; color?: string }

export function seriesColor(index: number, override?: string): string {
  return override ?? SERIES[index % SERIES.length]!
}

export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1
  const exp = Math.floor(Math.log10(max))
  const base = Math.pow(10, exp)
  const norm = max / base
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return step * base
}

export function numericRange(values: number[], pad = 0.06): { min: number; max: number } {
  let lo = Infinity
  let hi = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 }
  if (lo === hi) return { min: lo - 1, max: hi + 1 }
  const margin = (hi - lo) * pad
  const min = lo >= 0 && lo - margin <= 0 ? 0 : lo - margin
  const max = hi <= 0 && hi + margin >= 0 ? 0 : hi + margin
  return { min, max }
}

export type DocOptions = {
  title?: string
  subtitle?: string
  aria?: string
}

export function svgDoc(width: number, height: number, body: string, opts: DocOptions = {}): string {
  const titleBlock = opts.title
    ? [
        `<text x="16" y="24" font-size="15" font-weight="600" fill="${INK_STRONG}">${esc(opts.title)}</text>`,
        opts.subtitle
          ? `<text x="16" y="42" font-size="11" fill="${INK}">${esc(opts.subtitle)}</text>`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : ""
  const aria = esc(opts.aria ?? opts.title ?? "chart")
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${aria}" font-family="${FONT}">`,
    titleBlock,
    body,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("\n")
}

export function topOffset(opts: DocOptions): number {
  if (opts.title && opts.subtitle) return 56
  if (opts.title) return 40
  return 14
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(1, max - 1))}…`
}

export function gridLines(opts: {
  x1: number
  x2: number
  top: number
  bottom: number
  max: number
  unit?: string
}): string {
  const rows: string[] = []
  for (let i = 0; i <= 4; i++) {
    const y = opts.bottom - ((opts.bottom - opts.top) * i) / 4
    rows.push(
      `<line x1="${opts.x1}" y1="${y}" x2="${opts.x2}" y2="${y}" stroke="${GRID}" stroke-opacity="0.3" stroke-width="1"/>`,
    )
    if (i > 0) {
      const value = (opts.max * i) / 4
      rows.push(
        `<text x="${opts.x1 - 6}" y="${y + 3.5}" font-size="10" fill="${INK}" text-anchor="end">${esc(fmtAxis(value, opts.unit))}</text>`,
      )
    }
  }
  rows.push(
    `<line x1="${opts.x1}" y1="${opts.bottom}" x2="${opts.x2}" y2="${opts.bottom}" stroke="${FRAME}" stroke-opacity="0.7" stroke-width="1"/>`,
  )
  return rows.join("\n")
}

function fmtAxis(value: number, unit?: string): string {
  const abs = Math.abs(value)
  let text: string
  if (abs >= 1_000_000_000) text = `${round(value / 1_000_000_000)}B`
  else if (abs >= 1_000_000) text = `${round(value / 1_000_000)}M`
  else if (abs >= 1_000) text = `${round(value / 1_000)}k`
  else text = `${round(value)}`
  return unit === "%" ? `${text}%` : unit ? `${text}${unit}` : text
}

function round(n: number): string {
  const r = Math.round(n * 10) / 10
  return String(r)
}

export function legendRow(opts: {
  y: number
  x?: number
  entries: { label: string; color: string }[]
  width?: number
}): string {
  const x0 = opts.x ?? 16
  const width = opts.width ?? 608
  const step = opts.entries.length > 0 ? width / opts.entries.length : width
  return opts.entries
    .map((entry, i) => {
      const x = x0 + i * step
      return [
        `<rect x="${x}" y="${opts.y - 8}" width="9" height="9" rx="2" fill="${entry.color}"/>`,
        `<text x="${x + 14}" y="${opts.y}" font-size="11" fill="${INK}">${esc(truncate(entry.label, Math.max(6, Math.floor(step / 7))))}</text>`,
      ].join("")
    })
    .join("\n")
}

export function polarPoint(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}
