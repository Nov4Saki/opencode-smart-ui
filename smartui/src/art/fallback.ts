import { fmtCompact, fmtNum } from "../util.ts"

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

export function sparklineArt(values: number[]): string[] {
  if (values.length === 0) return ["no data"]
  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ["no data"]
  const span = max - min || 1
  const row = values
    .map((v) => BLOCKS[Math.min(BLOCKS.length - 1, Math.max(0, Math.round(((v - min) / span) * (BLOCKS.length - 1))))]!)
    .join("")
  return [`${row}  (min ${fmtCompact(min)} · max ${fmtCompact(max)})`]
}

export function barArt(items: { label: string; value: number }[], unit?: string): string[] {
  if (items.length === 0) return ["no data"]
  const max = Math.max(1, ...items.map((item) => Math.max(0, item.value)))
  const labelW = Math.min(24, Math.max(...items.map((item) => item.label.length)))
  const barW = 32
  const lines = items.map((item) => {
    const filled = Math.max(0, Math.round((Math.max(0, item.value) / max) * barW))
    const bar = `${"█".repeat(filled)}${"░".repeat(barW - filled)}`
    const value = unit ? `${fmtCompact(item.value)}${unit}` : fmtCompact(item.value)
    return `${item.label.padEnd(labelW)} ${bar} ${value}`
  })
  return lines
}

export function columnArt(labels: string[], series: { name?: string; values: number[] }[], opts: { percent?: boolean } = {}): string[] {
  if (series.length === 0 || labels.length === 0) return ["no data"]
  if (series.length > 1) {
    return labels.map((label, i) =>
      `${label}: ${series.map((s) => `${s.name ?? "·"} ${fmtCompact(s.values[i] ?? 0)}`).join(", ")}`,
    )
  }
  const values = series[0]!.values
  const max = Math.max(1, ...values.map((v) => Math.max(0, v)))
  const rows = 8
  const labelW = Math.min(16, Math.max(...labels.map((l) => l.length)))
  const cellW = labelW + 2
  const lines: string[] = []
  for (let r = rows; r >= 1; r--) {
    let line = ""
    for (let i = 0; i < labels.length; i++) {
      const filled = Math.round((Math.max(0, values[i] ?? 0) / max) * rows)
      const cell = filled >= r ? "█" : filled === r - 1 ? "▄" : " "
      line += cell.padEnd(cellW)
    }
    lines.push(line.replace(/\s+$/, ""))
  }
  const labelRow = labels.map((l) => l.slice(0, labelW).padEnd(cellW)).join("").replace(/\s+$/, "")
  lines.push(labelRow)
  if (opts.percent) {
    const total = values.reduce((sum, v) => sum + Math.max(0, v), 0) || 1
    lines.push(values.map((v) => `${Math.round((Math.max(0, v) / total) * 100)}%`.padEnd(cellW)).join("").replace(/\s+$/, ""))
  }
  return lines
}

export function donutArt(slices: { label: string; value: number }[]): string[] {
  if (slices.length === 0) return ["no data"]
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0) || 1
  const labelW = Math.min(20, Math.max(...slices.map((slice) => slice.label.length)))
  const barW = 24
  return slices.map((slice) => {
    const fraction = Math.max(0, slice.value) / total
    const filled = Math.max(0, Math.round(fraction * barW))
    const bar = `${"█".repeat(filled)}${"░".repeat(barW - filled)}`
    return `${slice.label.padEnd(labelW)} ${bar} ${fmtCompact(slice.value)} · ${Math.round(fraction * 100)}%`
  })
}

export function gaugeArt(value: number, opts: { min?: number; max?: number; label?: string; unit?: string } = {}): string[] {
  const min = opts.min ?? 0
  const max = opts.max ?? 100
  const fraction = Math.min(1, Math.max(0, (value - min) / (max - min || 1)))
  const width = 32
  const filled = Math.round(fraction * width)
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`
  const unit = opts.unit === undefined ? "%" : opts.unit
  const head = `[${bar}] ${fmtNum(value)}${unit}`
  return opts.label ? [opts.label, head] : [head]
}

const SCATTER_MARKERS = ["●", "○", "◆", "▲", "■", "◇"]

export function scatterArt(
  series: { name?: string; points: [number, number][] }[],
  opts: { width?: number; rows?: number; total?: number } = {},
): string[] {
  const points = series.flatMap((entry, si) => (entry.points ?? []).map((point) => ({ x: point[0], y: point[1], si })))
  if (points.length === 0) return ["no data"]
  const width = opts.width ?? 40
  const rows = opts.rows ?? 12
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const point of points) {
    if (point.x < xMin) xMin = point.x
    if (point.x > xMax) xMax = point.x
    if (point.y < yMin) yMin = point.y
    if (point.y > yMax) yMax = point.y
  }
  const grid = Array.from({ length: rows }, () => new Array<string>(width).fill(" "))
  for (const point of points) {
    const col = xMax === xMin ? Math.floor(width / 2) : Math.round(((point.x - xMin) / (xMax - xMin)) * (width - 1))
    const row = yMax === yMin ? Math.floor(rows / 2) : rows - 1 - Math.round(((point.y - yMin) / (yMax - yMin)) * (rows - 1))
    grid[row]![col] = SCATTER_MARKERS[point.si % SCATTER_MARKERS.length]!
  }
  const lines = grid.map((row) => row.join("").replace(/\s+$/, ""))
  const legend = series.map((entry, i) => `${SCATTER_MARKERS[i % SCATTER_MARKERS.length]} ${entry.name ?? `Series ${i + 1}`}`).join("  ")
  return [
    `x ${fmtCompact(xMin)}…${fmtCompact(xMax)} · y ${fmtCompact(yMin)}…${fmtCompact(yMax)}`,
    ...lines,
    series.length > 1 ? legend : `${opts.total ?? points.length} points`,
  ]
}

export function waterfallArt(items: { label: string; value: number }[], unit?: string): string[] {
  if (items.length === 0) return ["no data"]
  const labelW = Math.min(20, Math.max(...items.map((item) => item.label.length)))
  const barW = 24
  const span = Math.max(1, ...items.map((item) => Math.abs(item.value)))
  let running = 0
  const lines = items.map((item) => {
    running += item.value
    const filled = Math.max(0, Math.round((Math.abs(item.value) / span) * barW))
    const bar = `${"█".repeat(filled)}${"░".repeat(barW - filled)}`
    const sign = item.value >= 0 ? "+" : ""
    return `${item.label.slice(0, labelW).padEnd(labelW)} ${bar} ${sign}${fmtCompact(item.value)}${unit ?? ""} → ${fmtCompact(running)}`
  })
  lines.push(`${"total".padEnd(labelW)} ${fmtCompact(running)}${unit ?? ""}`)
  return lines
}

const HEAT = [" ", "·", "░", "▒", "▓", "█"]

export function heatmapArt(
  values: number[][],
  opts: { rowLabels?: string[]; columnLabels?: string[] } = {},
): string[] {
  if (values.length === 0) return ["no data"]
  const flat = values.flat().filter((value) => Number.isFinite(value))
  const lo = Math.min(0, ...flat)
  const hi = Math.max(1, ...flat)
  const labelW = Math.min(16, Math.max(0, ...(opts.rowLabels ?? []).map((label) => label.length)))
  const charOf = (value: number | undefined): string => {
    if (value === undefined || !Number.isFinite(value)) return " "
    const t = (value - lo) / (hi - lo || 1)
    return HEAT[Math.min(HEAT.length - 1, Math.max(1, Math.round(t * (HEAT.length - 1))))]!
  }
  const lines = values.map((row, r) => {
    const label = (opts.rowLabels?.[r] ?? "").slice(0, labelW).padEnd(labelW)
    return `${label} ${row.map(charOf).join(" ")}`
  })
  if (opts.columnLabels) lines.unshift(`${"".padEnd(labelW)} ${opts.columnLabels.join(" ")}`)
  return lines
}

export function radarArt(axes: string[], series: { name?: string; values: number[] }[]): string[] {
  if (axes.length === 0 || series.length === 0) return ["no data"]
  const max = Math.max(1, ...series.flatMap((entry) => entry.values.map((value) => Math.abs(value))))
  const labelW = Math.min(16, Math.max(...axes.map((axis) => axis.length)))
  const barW = 20
  return axes.map((axis, i) => {
    const cells = series.map((entry) => {
      const value = Math.min(max, Math.max(0, entry.values[i] ?? 0))
      const filled = Math.max(0, Math.round((value / max) * barW))
      const bar = `${"█".repeat(filled)}${"░".repeat(barW - filled)}`
      return series.length > 1 ? `${entry.name ?? "·"} ${bar}` : bar
    })
    const head = Math.min(max, Math.max(0, series[0]!.values[i] ?? 0))
    return `${axis.slice(0, labelW).padEnd(labelW)} ${cells.join("  ")} ${fmtCompact(head)}`
  })
}

function dateLabel(value: number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fmtCompact(value) : date.toISOString().slice(0, 10)
}

export function timelineArt(items: { label: string; start: number; end: number }[], dates?: boolean): string[] {
  if (items.length === 0) return ["no data"]
  const lo = Math.min(...items.map((item) => Math.min(item.start, item.end)))
  const hi = Math.max(...items.map((item) => Math.max(item.start, item.end)))
  const span = hi - lo || 1
  const labelW = Math.min(20, Math.max(...items.map((item) => item.label.length)))
  const width = 36
  const lines = items.map((item) => {
    const from = Math.round(((Math.min(item.start, item.end) - lo) / span) * (width - 2))
    const to = Math.max(from + 1, Math.round(((Math.max(item.start, item.end) - lo) / span) * (width - 2)))
    const bar = `${" ".repeat(from)}${"▄".repeat(Math.max(1, to - from))}`.padEnd(width)
    const range = dates
      ? `${dateLabel(item.start)} → ${dateLabel(item.end)}`
      : `${fmtCompact(item.start)} → ${fmtCompact(item.end)}`
    return `${item.label.slice(0, labelW).padEnd(labelW)} |${bar}| ${range}`
  })
  const spanLabel = dates ? `${dateLabel(lo)} … ${dateLabel(hi)}` : `${fmtCompact(lo)} … ${fmtCompact(hi)}`
  lines.push(`${"".padEnd(labelW)}  ${spanLabel}`)
  return lines
}

export function funnelArt(items: { label: string; value: number }[], unit?: string): string[] {
  if (items.length === 0) return ["no data"]
  const first = Math.max(1, items[0]?.value ?? 1)
  const max = Math.max(1, ...items.map((item) => Math.max(0, item.value)))
  const labelW = Math.min(20, Math.max(...items.map((item) => item.label.length)))
  const barW = 28
  return items.map((item) => {
    const value = Math.max(0, item.value)
    const filled = Math.max(0, Math.round((value / max) * barW))
    const bar = `${"█".repeat(filled)}${"░".repeat(barW - filled)}`
    const pct = Math.round((value / first) * 100)
    return `${item.label.slice(0, labelW).padEnd(labelW)} ${bar} ${fmtCompact(value)}${unit ?? ""} · ${pct}%`
  })
}

export function progressArt(
  value: number,
  opts: { min?: number; max?: number; label?: string; unit?: string; bands?: { upTo: number; label?: string }[] } = {},
): string[] {
  const min = opts.min ?? 0
  const max = opts.max ?? 100
  const fraction = Math.min(1, Math.max(0, (value - min) / (max - min || 1)))
  const width = 40
  const filled = Math.round(fraction * width)
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`
  const unit = opts.unit === undefined ? "%" : opts.unit
  const lines = [`[${bar}] ${fmtNum(value)}${unit}`]
  if (opts.label) lines.unshift(opts.label)
  if (opts.bands && opts.bands.length > 0) {
    lines.push(
      opts.bands
        .map((band) => {
          const at = Math.round(((Math.min(max, Math.max(min, band.upTo)) - min) / (max - min || 1)) * 100)
          return `| ${band.label ?? fmtCompact(band.upTo)} @${at}%`
        })
        .join("  "),
    )
  }
  return lines
}

export function treemapArt(items: { label: string; value: number }[]): string[] {
  const positive = items.filter((item) => Number.isFinite(item.value) && item.value > 0)
  if (positive.length === 0) return ["no data"]
  const sorted = [...positive].sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, item) => sum + item.value, 0)
  const labelW = Math.min(20, Math.max(...sorted.map((item) => item.label.length)))
  const barW = 28
  return sorted.map((item) => {
    const share = item.value / total
    const filled = Math.max(1, Math.round(share * barW))
    const bar = `${"█".repeat(filled)}${"░".repeat(barW - filled)}`
    return `${item.label.slice(0, labelW).padEnd(labelW)} ${bar} ${fmtCompact(item.value)} · ${Math.round(share * 100)}%`
  })
}
