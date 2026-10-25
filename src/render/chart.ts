import { Raster } from "./raster.ts"
import { bar, clamp, displayWidth, formatNumber, formatPct, padCenter, padLeft, padRight, truncate, wrapText } from "./util.ts"

export type ChartKind =
  | "bar"
  | "column"
  | "line"
  | "area"
  | "scatter"
  | "donut"
  | "histogram"
  | "sparkline"
  | "heatmap"
  | "box"
  | "gauge"
  | "bullet"
  | "waterfall"
  | "funnel"
  | "calendar"

export type ChartPoint = {
  label?: string
  value: number
  type?: "abs" | "delta" | "total"
}

export type ChartSeriesInput = {
  name?: string
  values?: number[]
  points?: ChartPoint[]
}

export type ChartHeatRow = {
  label?: string
  values: number[]
}

export type ChartBand = {
  upTo: number
  label?: string
}

export type ChartBulletItem = {
  label: string
  value: number
  target?: number
  max?: number
}

export type ChartInput = {
  chart: ChartKind
  title?: string
  data?: ChartPoint[]
  series?: ChartSeriesInput[]
  values?: number[]
  labels?: string[]
  bins?: number
  rows?: ChartHeatRow[]
  items?: ChartBulletItem[]
  bands?: ChartBand[]
  unit?: string
  width?: number
  height?: number
  max?: number
  min?: number
  value?: number
  stacked?: boolean
  grouped?: boolean
  percent?: boolean
  whiskers?: "minmax" | "tukey"
}

type Series = {
  name?: string
  points: ChartPoint[]
}

type ChartContext = {
  width: number
  unit: string
}

const SERIES_SAMPLES = ["───", "╌╌╌", "┈┈┈"]
const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
const DONUT_TEXTURES = ["█", "▓", "▒", "░"]

function normalize(input: ChartInput): Series[] {
  const labels = input.labels
  const applyLabels = (points: ChartPoint[]): ChartPoint[] =>
    points.map((point, index) => (point.label === undefined && labels?.[index] !== undefined ? { ...point, label: labels[index] } : point))
  if (input.series && input.series.length > 0) {
    return input.series.map((series) => ({
      name: series.name,
      points: applyLabels(
        series.points ??
          (series.values ?? []).map((value) => ({ value })),
      ),
    }))
  }
  if (input.data && input.data.length > 0) {
    return [{ points: applyLabels(input.data) }]
  }
  if (input.values && input.values.length > 0) {
    return [{ points: applyLabels(input.values.map((value) => ({ value }))) }]
  }
  throw new Error("chart has no data: pass `data`, `series`, or `values`")
}

function finitePoints(points: ChartPoint[]): ChartPoint[] {
  return points.filter((point) => Number.isFinite(point.value))
}

function valueText(value: number, unit: string): string {
  return formatNumber(value) + unit
}

function xLabel(point: ChartPoint, index: number): string {
  return point.label ?? String(index + 1)
}

function chartTitle(input: ChartInput, fallback: string): string[] {
  const title = input.title ? truncate(input.title, 80) : fallback
  return [title]
}

function renderBar(points: ChartPoint[], ctx: ChartContext, explicitMax?: number): string[] {
  const data = finitePoints(points)
  if (data.length === 0) throw new Error("bar chart needs at least one finite value")
  const values = data.map((point) => point.value)
  const offset = Math.min(0, ...values)
  const max = Math.max(explicitMax ?? Math.max(...values), offset + 1e-9)
  const labelWidth = clamp(Math.max(...data.map((point, index) => displayWidth(xLabel(point, index)))), 4, 20)
  const texts = data.map((point) => valueText(point.value, ctx.unit))
  const valueWidth = Math.max(...texts.map((text) => displayWidth(text)))
  const barWidth = Math.max(6, ctx.width - labelWidth - valueWidth - 2)
  return data.map((point, index) => {
    const fraction = (point.value - offset) / (max - offset)
    const label = padRight(truncate(xLabel(point, index), labelWidth), labelWidth)
    return label + " " + bar(fraction, barWidth) + " " + padLeft(texts[index] ?? "", valueWidth)
  })
}

function renderColumns(points: ChartPoint[], ctx: ChartContext, options: { height?: number; max?: number }): string[] {
  const data = finitePoints(points)
  if (data.length === 0) throw new Error("column chart needs at least one finite value")
  const height = clamp(options.height ?? 8, 3, 14)
  const values = data.map((point) => point.value)
  const lo = Math.min(0, ...values)
  const hi = Math.max(options.max ?? Math.max(...values), lo + 1e-9)
  const n = data.length
  const stride = Math.max(1, Math.floor(ctx.width / n))
  const columnWidth = stride >= 2 ? stride - 1 : 1
  const gap = stride >= 2 ? 1 : 0
  const used = n * columnWidth + (n - 1) * gap
  const raster = new Raster(used, height)
  const subHeight = raster.subHeight
  const baseline = baselineRow((0 - lo) / (hi - lo), subHeight)
  data.forEach((point, index) => {
    const valueY = baselineRow((point.value - lo) / (hi - lo), subHeight)
    const top = Math.min(valueY, baseline)
    const bottom = Math.max(valueY, baseline)
    const x0 = index * (columnWidth + gap)
    for (let y2 = top; y2 <= bottom; y2++) {
      for (let x2 = x0 * 2; x2 < (x0 + columnWidth) * 2; x2++) {
        raster.setSub(x2, y2)
      }
    }
  })
  const lines = raster.toLines()
  const maxLabels = Math.max(1, Math.floor(used / 7))
  const labelEvery = Math.max(1, Math.ceil(n / maxLabels))
  const labelRow: string[] = new Array(used).fill(" ")
  for (let index = 0; index < n; index += labelEvery) {
    const slot = labelEvery * stride
    const text = truncate(xLabel(data[index]!, index), Math.max(3, slot - 1))
    const start = index * stride
    let cursor = start
    for (const ch of text) {
      if (cursor >= used) break
      labelRow[cursor] = ch
      cursor += 1
    }
  }
  const labelLine = labelRow.join("").replace(/\s+$/, "")
  return [...lines, labelLine]
}

function baselineRow(fraction: number, subHeight: number): number {
  return subHeight - 1 - Math.round(clamp(fraction, 0, 1) * (subHeight - 1))
}

function seriesDensity(seriesIndex: number): (x2: number, y2: number) => boolean {
  if (seriesIndex === 1) return (x2, y2) => (x2 + y2) % 2 === 0
  if (seriesIndex >= 2) return (x2, y2) => x2 % 2 === 0 && y2 % 2 === 0
  return () => true
}

function renderCartesian(
  series: Series[],
  ctx: ChartContext,
  options: { height?: number; max?: number; area?: boolean; scatter?: boolean },
): string[] {
  const clean = series.map((s) => ({ name: s.name, points: finitePoints(s.points) })).filter((s) => s.points.length > 0)
  if (clean.length === 0) throw new Error("chart needs at least one finite value")
  if (options.area && clean.length > 1) clean.splice(1)
  const allValues = clean.flatMap((s) => s.points.map((point) => point.value))
  const lo = Math.min(...allValues)
  const hi = Math.max(options.max ?? Math.max(...allValues), lo + 1e-9)
  const height = clamp(options.height ?? 7, 3, 12)
  const yTexts = [valueText(hi, ctx.unit), valueText((hi + lo) / 2, ctx.unit), valueText(lo, ctx.unit)]
  const yWidth = clamp(Math.max(...yTexts.map((text) => displayWidth(text))), 1, 8)
  const plotWidth = Math.max(8, ctx.width - yWidth - 1)
  const raster = new Raster(plotWidth, height)
  const subWidth = raster.subWidth
  const subHeight = raster.subHeight
  const mapX = (index: number, count: number) => (count <= 1 ? (subWidth - 1) / 2 : (index / (count - 1)) * (subWidth - 1))
  const mapY = (value: number) => subHeight - 1 - Math.round(((value - lo) / (hi - lo)) * (subHeight - 1))
  clean.forEach((s, seriesIndex) => {
    const accept = seriesDensity(seriesIndex)
    if (options.scatter) {
      s.points.forEach((point, index) => {
        const x = Math.round(mapX(index, s.points.length))
        const y = mapY(point.value)
        raster.setSub(x, y)
        raster.setSub(x + 1, y)
        raster.setSub(x, y + 1)
      })
      return
    }
    if (options.area) {
      for (let x2 = 0; x2 < subWidth; x2++) {
        const t = s.points.length <= 1 ? 0 : (x2 / (subWidth - 1)) * (s.points.length - 1)
        const index = Math.min(s.points.length - 2, Math.floor(t))
        const frac = t - index
        const a = mapY(s.points[Math.max(0, index)]!.value)
        const b = mapY(s.points[Math.max(0, index + 1)]!.value)
        const y = Math.round(a + (b - a) * frac)
        for (let y2 = y; y2 < subHeight; y2++) {
          if ((x2 + y2) % 8 !== 0) raster.setSub(x2, y2)
        }
      }
    }
    for (let index = 0; index < s.points.length - 1; index++) {
      raster.line(mapX(index, s.points.length), mapY(s.points[index]!.value), mapX(index + 1, s.points.length), mapY(s.points[index + 1]!.value), accept)
    }
    if (s.points.length === 1) {
      raster.setSub(Math.round(mapX(0, 1)), mapY(s.points[0]!.value))
    }
  })
  const gutter = yWidth + 1
  const rasterLines = raster.toLines()
  const mid = Math.floor(height / 2)
  const lines = rasterLines.map((line, row) => {
    const label = row === 0 ? yTexts[0] : row === height - 1 ? yTexts[2] : row === mid ? yTexts[1] : ""
    return padLeft(truncate(label ?? "", yWidth), yWidth) + "┤" + line
  })
  lines.push(" ".repeat(yWidth) + "└" + "─".repeat(plotWidth))
  const first = clean[0]!
  const labelRow: string[] = new Array(plotWidth).fill(" ")
  const writeAt = (position: number, text: string) => {
    let cursor = position
    for (const ch of text) {
      if (cursor < 0 || cursor >= plotWidth) break
      labelRow[cursor] = ch
      cursor += 1
    }
  }
  const firstLabel = truncate(xLabel(first.points[0]!, 0), Math.floor(plotWidth / 3))
  const lastLabel = truncate(xLabel(first.points[first.points.length - 1]!, first.points.length - 1), Math.floor(plotWidth / 3))
  writeAt(0, firstLabel)
  writeAt(Math.max(0, plotWidth - displayWidth(lastLabel)), lastLabel)
  if (plotWidth > 12) {
    const midIndex = Math.floor((first.points.length - 1) / 2)
    const midLabel = truncate(xLabel(first.points[midIndex]!, midIndex), Math.floor(plotWidth / 3))
    writeAt(Math.max(0, Math.floor((plotWidth - displayWidth(midLabel)) / 2)), midLabel)
  }
  lines.push(" ".repeat(gutter) + labelRow.join("").replace(/\s+$/, ""))
  if (clean.length > 1) {
    const legend = clean.map((s, index) => (SERIES_SAMPLES[index % SERIES_SAMPLES.length] ?? "───") + " " + (s.name ?? `series ${index + 1}`)).join("   ")
    lines.push(...wrapText(legend, ctx.width))
  }
  return lines
}

function renderSparkline(series: Series[], ctx: ChartContext): string[] {
  const clean = series.map((s) => ({ name: s.name, values: s.points.map((point) => point.value).filter(Number.isFinite) })).filter((s) => s.values.length > 0)
  if (clean.length === 0) throw new Error("sparkline needs at least one finite value")
  const nameWidth = clamp(Math.max(...clean.map((s) => displayWidth(s.name ?? ""))), 0, 14)
  return clean.map((s) => {
    const lo = Math.min(...s.values)
    const hi = Math.max(...s.values)
    const range = hi - lo || 1
    const sampleEvery = Math.max(1, Math.ceil(s.values.length / Math.max(8, ctx.width - nameWidth - 16)))
    const glyphs = s.values
      .filter((_, index) => index % sampleEvery === 0 || index === s.values.length - 1)
      .map((value) => SPARK_CHARS[clamp(Math.round(((value - lo) / range) * 7), 0, 7)] ?? "▁")
      .join("")
    const prefix = nameWidth > 0 ? padRight(truncate(s.name ?? "", nameWidth), nameWidth) + " " : ""
    return `${prefix}${glyphs}  ${formatNumber(lo)}–${formatNumber(hi)}${ctx.unit}`
  })
}

function renderDonut(points: ChartPoint[], ctx: ChartContext, explicitWidth?: number): string[] {
  const data = finitePoints(points).filter((point) => point.value > 0)
  if (data.length === 0) throw new Error("donut chart needs at least one positive value")
  const total = data.reduce((sum, point) => sum + point.value, 0)
  const width = clamp(explicitWidth ?? 21, 13, Math.min(31, ctx.width))
  const subWidth = width * 2
  const radius = subWidth / 2 - 0.5
  const height = Math.ceil((radius + 1) / 2)
  const subHeight = height * 2
  const cx = subWidth / 2
  const cy = subHeight / 2
  const inner = radius * 0.55
  const slices: { from: number; to: number; glyph: string; density: (x2: number, y2: number) => boolean }[] = []
  let cumulative = 0
  for (let index = 0; index < data.length; index++) {
    const fraction = data[index]!.value / total
    const from = cumulative * Math.PI * 2
    cumulative += fraction
    const to = cumulative * Math.PI * 2
    slices.push({
      from,
      to,
      glyph: DONUT_TEXTURES[index % DONUT_TEXTURES.length] ?? "█",
      density: textureDensity(index % DONUT_TEXTURES.length),
    })
  }
  const boundaries = slices.slice(1).map((slice) => slice.from)
  const raster = new Raster(width, height)
  for (let y2 = 0; y2 < subHeight; y2++) {
    for (let x2 = 0; x2 < subWidth; x2++) {
      const dx = x2 + 0.5 - cx
      const dy = (y2 + 0.5 - cy) * 2
      const r = Math.sqrt(dx * dx + dy * dy)
      if (r > radius || r < inner) continue
      const angle = ((Math.atan2(dy, dx) + Math.PI / 2) + Math.PI * 2) % (Math.PI * 2)
      const gap = boundaries.length > 0 && boundaries.some((boundary) => circularDistance(angle, boundary) * r < 0.9)
      if (gap) continue
      const slice = slices.find((s) => angle >= s.from && (angle < s.to || s.to >= Math.PI * 2 - 1e-9))
      if (!slice || !slice.density(x2, y2)) continue
      raster.setSub(x2, y2)
    }
  }
  const lines = raster.toLines()
  const shareChars: string[] = []
  let previousEdge = 0
  let running = 0
  for (let index = 0; index < data.length; index++) {
    running += data[index]!.value
    const edge = index === data.length - 1 ? width : Math.round((running / total) * width)
    shareChars.push((DONUT_TEXTURES[index % DONUT_TEXTURES.length] ?? "█").repeat(Math.max(0, edge - previousEdge)))
    previousEdge = edge
  }
  lines.push(shareChars.join("").slice(0, width))
  const legendParts = data.map((point, index) => {
    const glyph = (DONUT_TEXTURES[index % DONUT_TEXTURES.length] ?? "█").repeat(2)
    return `${glyph} ${truncate(xLabel(point, index), 18)} ${formatPct(point.value / total, 1)}`
  })
  const legendLines: string[] = []
  let current = ""
  for (const part of legendParts) {
    if (!current) {
      current = part
    } else if (displayWidth(current) + 3 + displayWidth(part) <= ctx.width) {
      current += "   " + part
    } else {
      legendLines.push(current)
      current = part
    }
  }
  if (current) legendLines.push(current)
  lines.push(...legendLines)
  lines.push(`total ${formatNumber(total)}${ctx.unit}`)
  return lines
}

function circularDistance(a: number, b: number): number {
  const twoPi = Math.PI * 2
  const delta = Math.abs(a - b) % twoPi
  return Math.min(delta, twoPi - delta)
}

function textureDensity(textureIndex: number): (x2: number, y2: number) => boolean {
  if (textureIndex === 1) return (x2, y2) => (x2 + y2) % 4 !== 0
  if (textureIndex === 2) return (x2, y2) => (x2 + y2) % 2 === 0
  if (textureIndex === 3) return (x2, y2) => (x2 + y2) % 4 === 0
  return () => true
}

function renderHistogram(values: number[], ctx: ChartContext, bins?: number, height?: number): string[] {
  const data = values.filter(Number.isFinite)
  if (data.length === 0) throw new Error("histogram needs at least one finite value")
  const lo = Math.min(...data)
  const hi = Math.max(...data)
  const binCount = clamp(Math.round(bins ?? Math.ceil(Math.sqrt(data.length))), 3, 14)
  const binWidth = (hi - lo || 1) / binCount
  const counts = new Array(binCount).fill(0)
  for (const value of data) {
    const index = clamp(Math.floor((value - lo) / binWidth), 0, binCount - 1)
    counts[index] += 1
  }
  const points: ChartPoint[] = counts.map((count, index) => ({
    label: formatNumber(lo + index * binWidth),
    value: count,
  }))
  const caption = `n = ${data.length} · bin ${formatNumber(binWidth)}${ctx.unit}`
  return [caption, ...renderColumns(points, ctx, { height: height ?? 7 })]
}

function renderHeatmap(rows: ChartHeatRow[], ctx: ChartContext): string[] {
  const clean = rows.filter((row) => row.values.some(Number.isFinite))
  if (clean.length === 0) throw new Error("heatmap needs rows with numeric values")
  const all = clean.flatMap((row) => row.values).filter(Number.isFinite)
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const range = hi - lo || 1
  const shades = [" ", "░", "▒", "▓", "█"]
  const labelWidth = clamp(Math.max(0, ...clean.map((row) => displayWidth(row.label ?? ""))), 0, 14)
  const available = Math.max(4, ctx.width - labelWidth - 1)
  const widest = Math.max(...clean.map((row) => row.values.length))
  const stride = Math.max(1, Math.ceil(widest / available))
  const lines = clean.map((row) => {
    const cells = row.values
      .filter((_, index) => index % stride === 0)
      .map((value) => (Number.isFinite(value) ? shades[1 + clamp(Math.round(((value - lo) / range) * 3), 0, 3)] ?? "░" : " "))
      .join("")
    const prefix = labelWidth > 0 ? padRight(truncate(row.label ?? "", labelWidth), labelWidth) + " " : ""
    return prefix + cells
  })
  lines.push(`scale ░ ${formatNumber(lo)} · ▒ · ▓ · █ ${formatNumber(hi)}${ctx.unit}`)
  return lines
}

const MAX_MULTI_SERIES = 4
const MAX_BOX_SERIES = 8
const MAX_BULLET_ITEMS = 10
const MAX_FUNNEL_STAGES = 12
const DAY_MS = 86400000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function textureGlyph(index: number): string {
  return DONUT_TEXTURES[index % DONUT_TEXTURES.length] ?? "█"
}

function wrapParts(parts: string[], width: number, separator = "   "): string[] {
  const lines: string[] = []
  let current = ""
  for (const part of parts) {
    if (!current) {
      current = part
    } else if (displayWidth(current) + separator.length + displayWidth(part) <= width) {
      current += separator + part
    } else {
      lines.push(current)
      current = part
    }
  }
  if (current) lines.push(current)
  return lines
}

export function quartiles(values: number[]): { q1: number; median: number; q3: number } {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) throw new Error("quartiles need at least one finite value")
  const at = (q: number): number => {
    const position = q * (sorted.length - 1)
    const low = Math.floor(position)
    const high = Math.min(sorted.length - 1, low + 1)
    const fraction = position - low
    return sorted[low]! + (sorted[high]! - sorted[low]!) * fraction
  }
  return { q1: at(0.25), median: at(0.5), q3: at(0.75) }
}

function renderMultiColumns(
  series: Series[],
  ctx: ChartContext,
  options: { height?: number; max?: number; stacked?: boolean; percent?: boolean; grouped?: boolean },
): string[] {
  const clean = series
    .map((s) => ({ name: s.name, points: finitePoints(s.points) }))
    .filter((s) => s.points.length > 0)
  if (clean.length === 0) throw new Error("column chart needs at least one finite value")
  const stacked = Boolean(options.stacked || options.percent)
  const percent = Boolean(options.percent)
  const notes: string[] = []
  const usedSeries = clean.slice(0, MAX_MULTI_SERIES)
  if (clean.length > MAX_MULTI_SERIES) notes.push(`showing first ${MAX_MULTI_SERIES} of ${clean.length} series`)
  if (stacked) {
    for (const s of usedSeries) {
      if (s.points.some((point) => point.value < 0)) {
        throw new Error("stacked/percent column charts need non-negative values; use a line chart for signed data")
      }
    }
  }
  const n = Math.max(...usedSeries.map((s) => s.points.length))
  const sCount = usedSeries.length
  const height = clamp(options.height ?? 8, 3, 14)
  const gaps = n - 1
  const innerGaps = n * (sCount - 1)
  const columnWidth = Math.floor((ctx.width - gaps - innerGaps) / (n * sCount))
  if (columnWidth < 1) {
    throw new Error(`column chart: ${n} labels x ${sCount} series do not fit in ${ctx.width} columns; use fewer labels, a line chart, or a wider width`)
  }
  const groupWidth = sCount * columnWidth + (sCount - 1)
  const used = n * groupWidth + gaps
  const valueAt = (seriesIndex: number, index: number): number => Math.max(0, usedSeries[seriesIndex]!.points[index]?.value ?? 0)
  const totals: number[] = []
  for (let index = 0; index < n; index++) {
    let total = 0
    for (let s = 0; s < sCount; s++) total += valueAt(s, index)
    totals.push(total)
  }
  let lo = 0
  let hi = 1
  if (!percent) {
    if (stacked) {
      hi = Math.max(options.max ?? Math.max(...totals, 0), 1e-9)
    } else {
      const all = usedSeries.flatMap((s) => s.points.map((point) => point.value))
      lo = Math.min(0, ...all)
      hi = Math.max(options.max ?? Math.max(...all), lo + 1e-9)
    }
  }
  const grid: string[][] = Array.from({ length: height }, () => new Array(used).fill(" "))
  const rowsFromBottom = (value: number, span: number) => Math.round((value / span) * height)
  if (stacked) {
    const span = percent ? 1 : hi
    for (let index = 0; index < n; index++) {
      const x0 = index * (groupWidth + 1)
      let cursor = height
      let cum = 0
      for (let s = 0; s < sCount; s++) {
        const raw = valueAt(s, index)
        const value = percent ? (totals[index]! > 0 ? raw / totals[index]! : 0) : raw
        if (value <= 0) continue
        cum += value
        const top = Math.max(0, Math.min(height - rowsFromBottom(cum, span), cursor - 1))
        const glyph = textureGlyph(s)
        for (let r = top; r < cursor; r++) {
          const cells = grid[r]!
          for (let x = x0; x < x0 + groupWidth; x++) cells[x] = glyph
        }
        cursor = top
      }
    }
  } else {
    const span = hi - lo
    const zeroFromBottom = Math.round(((0 - lo) / span) * height)
    const zeroTopRow = height - zeroFromBottom
    for (let s = 0; s < sCount; s++) {
      const glyph = textureGlyph(s)
      for (let index = 0; index < n; index++) {
        const point = usedSeries[s]!.points[index]
        if (!point || point.value === 0) continue
        const rows = Math.max(1, rowsFromBottom(Math.abs(point.value), span))
        const x0 = index * (groupWidth + 1) + s * (columnWidth + 1)
        const top = point.value > 0 ? Math.max(0, zeroTopRow - rows) : Math.min(height - 1, zeroTopRow)
        const bottom = point.value > 0 ? Math.min(height - 1, zeroTopRow - 1) : Math.min(height - 1, zeroTopRow + rows - 1)
        for (let r = top; r <= bottom; r++) {
          const cells = grid[r]!
          for (let x = x0; x < x0 + columnWidth; x++) cells[x] = glyph
        }
      }
    }
  }
  const lines = grid.map((row) => row.join(""))
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift()
  for (let i = 0; i < lines.length; i++) lines[i] = lines[i]!.replace(/\s+$/, "")
  const maxLabels = Math.max(1, Math.floor(used / 7))
  const labelEvery = Math.max(1, Math.ceil(n / maxLabels))
  const stride = groupWidth + 1
  const labelRow: string[] = new Array(used).fill(" ")
  for (let index = 0; index < n; index += labelEvery) {
    const source = usedSeries[0]!.points[index] ?? { value: 0 }
    const text = truncate(xLabel(source, index), Math.max(3, labelEvery * stride - 1))
    let cursor = index * stride
    for (const ch of text) {
      if (cursor >= used) break
      labelRow[cursor] = ch
      cursor += 1
    }
  }
  const body = [...lines, labelRow.join("").replace(/\s+$/, "")]
  body.push(...wrapParts(
    usedSeries.map((s, index) => `${textureGlyph(index).repeat(2)} ${s.name ?? `series ${index + 1}`}`),
    ctx.width,
  ))
  if (percent) body.unshift("percent stacked · each column = 100%")
  body.push(...notes)
  return body
}

function renderBoxPlot(
  series: Series[],
  ctx: ChartContext,
  options: { whiskers?: "minmax" | "tukey"; max?: number },
): string[] {
  const clean = series
    .map((s) => ({ name: s.name, values: s.points.map((point) => point.value).filter(Number.isFinite).sort((a, b) => a - b) }))
    .filter((s) => s.values.length > 0)
  if (clean.length === 0) throw new Error("box plot needs at least one finite value")
  const notes: string[] = []
  const shown = clean.slice(0, MAX_BOX_SERIES)
  if (clean.length > MAX_BOX_SERIES) notes.push(`showing first ${MAX_BOX_SERIES} of ${clean.length} series`)
  const all = shown.flatMap((s) => s.values)
  const lo = Math.min(...all)
  const hi = Math.max(options.max ?? Math.max(...all), lo + 1e-9)
  const labelWidth = clamp(
    Math.max(...shown.map((s, index) => displayWidth(s.name ?? `series ${index + 1}`))),
    4,
    14,
  )
  const gutter = labelWidth + 2
  const plotWidth = Math.max(8, ctx.width - gutter)
  const mapX = (value: number) => clamp(Math.round(((value - lo) / (hi - lo)) * (plotWidth - 1)), 0, plotWidth - 1)
  const whiskerMode = options.whiskers ?? "tukey"
  const rows: string[] = []
  shown.forEach((s, index) => {
    const { q1, median, q3 } = quartiles(s.values)
    const iqr = q3 - q1
    let whiskerLo = s.values[0]!
    let whiskerHi = s.values[s.values.length - 1]!
    let outliers: number[] = []
    if (whiskerMode === "tukey") {
      const fenceLo = q1 - 1.5 * iqr
      const fenceHi = q3 + 1.5 * iqr
      whiskerLo = s.values.find((value) => value >= fenceLo) ?? s.values[0]!
      whiskerHi = [...s.values].reverse().find((value) => value <= fenceHi) ?? s.values[s.values.length - 1]!
      outliers = s.values.filter((value) => value < fenceLo || value > fenceHi)
    }
    const chars: string[] = new Array(plotWidth).fill(" ")
    const left = mapX(whiskerLo)
    const right = mapX(whiskerHi)
    for (let x = left; x <= right; x++) chars[x] = "─"
    chars[left] = "├"
    chars[right] = "┤"
    const boxLeft = mapX(q1)
    const boxRight = mapX(q3)
    for (let x = boxLeft; x <= boxRight; x++) chars[x] = "▓"
    const medianX = mapX(median)
    chars[medianX] = "│"
    for (const value of outliers) chars[mapX(value)] = "×"
    const name = padRight(truncate(s.name ?? `series ${index + 1}`, labelWidth), labelWidth)
    rows.push(name + " ┤" + chars.join(""))
  })
  rows.push(" ".repeat(gutter) + "└" + "─".repeat(plotWidth))
  const labelRow: string[] = new Array(plotWidth).fill(" ")
  const writeAt = (position: number, text: string) => {
    let cursor = position
    for (const ch of text) {
      if (cursor < 0 || cursor >= plotWidth) break
      labelRow[cursor] = ch
      cursor += 1
    }
  }
  const slot = Math.floor(plotWidth / 3)
  const loText = truncate(formatNumber(lo) + ctx.unit, slot)
  const hiText = truncate(formatNumber(hi) + ctx.unit, slot)
  writeAt(0, loText)
  writeAt(Math.max(0, plotWidth - displayWidth(hiText)), hiText)
  if (plotWidth > 24) {
    const midText = truncate(((lo + hi) / 2 !== lo ? formatNumber((lo + hi) / 2) : "") + ctx.unit, slot)
    writeAt(Math.max(0, Math.floor((plotWidth - displayWidth(midText)) / 2)), midText)
  }
  rows.push(" ".repeat(gutter) + labelRow.join("").replace(/\s+$/, ""))
  rows.push(...notes)
  return rows
}

function renderGauge(
  series: Series[],
  ctx: ChartContext,
  options: { value?: number; min?: number; max?: number; bands?: ChartBand[]; unit: string; width?: number },
): string[] {
  const fallback = series.flatMap((s) => s.points.map((point) => point.value)).find((value) => Number.isFinite(value))
  const value = options.value ?? fallback
  if (value === undefined || !Number.isFinite(value)) throw new Error("gauge needs a numeric `value` (or a single data point)")
  const bands = options.bands ?? []
  const bandMax = bands.length > 0 ? bands[bands.length - 1]!.upTo : undefined
  const min = options.min ?? 0
  const max = options.max ?? bandMax ?? 100
  if (!(max > min)) throw new Error(`gauge needs max > min (got min=${min}, max=${max})`)
  const width = clamp(options.width ?? 17, 11, Math.min(29, ctx.width))
  const radius = (width - 1) / 2
  const startAngle = (240 * Math.PI) / 180
  const sweep = (240 * Math.PI) / 180
  const height = Math.ceil(radius * 0.75) + 2
  const cx = width / 2
  const cy = Math.ceil(radius / 2) + 1
  const fraction = clamp((value - min) / (max - min), 0, 1)
  const bandFractions = bands.map((band) => clamp((band.upTo - min) / (max - min), 0, 1))
  const grid: string[][] = Array.from({ length: height }, () => new Array(width).fill(" "))
  const sub = [0.25, 0.75]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let covered = false
      for (const sy of sub) {
        for (const sx of sub) {
          const dx = x + sx - cx
          const dy = (y + sy - cy) * 2
          const r = Math.sqrt(dx * dx + dy * dy)
          if (r <= radius && r >= radius * 0.72) {
            covered = true
            break
          }
        }
        if (covered) break
      }
      if (!covered) continue
      const dx = x + 0.5 - cx
      const dy = (y + 0.5 - cy) * 2
      const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2)
      const offset = (angle - startAngle + Math.PI * 2) % (Math.PI * 2)
      if (offset > sweep) continue
      const position = offset / sweep
      if (position <= fraction) {
        let bandIndex = bands.length - 1
        if (bands.length > 0) {
          const found = bandFractions.findIndex((end) => position <= end)
          bandIndex = found === -1 ? bands.length - 1 : found
        }
        grid[y]![x] = textureGlyph(bands.length > 0 ? bands.length - 1 - bandIndex : 0)
      } else {
        grid[y]![x] = "░"
      }
    }
  }
  const needleAngle = startAngle + fraction * sweep
  const endX = cx + Math.sin(needleAngle) * radius * 0.92
  const endY = cy - (Math.cos(needleAngle) * radius * 0.92) / 2
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(endX - cx), Math.abs(endY - cy))))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = Math.round(cx + (endX - cx) * t - 0.5)
    const y = Math.round(cy + (endY - cy) * t - 0.5)
    if (x >= 0 && x < width && y >= 0 && y < height) grid[y]![x] = "█"
  }
  const lines = grid.map((row) => row.join("").replace(/\s+$/, ""))
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop()
  const valueText = formatNumber(value) + ctx.unit
  const leftText = truncate(formatNumber(min), 5)
  const rightText = truncate(formatNumber(max), 5)
  const middleWidth = Math.max(1, width - displayWidth(leftText) - displayWidth(rightText))
  lines.push(leftText + padCenter(truncate(valueText, middleWidth), middleWidth) + rightText)
  if (bands.length > 0) {
    lines.push(...wrapParts(
      bands.map((band, index) => `${textureGlyph(bands.length - 1 - index).repeat(2)} ${band.label ?? "≤" + formatNumber(band.upTo)}`),
      ctx.width,
    ))
  }
  if (value > max) lines.push(`▲ ${formatNumber(value)}${ctx.unit} exceeds max ${formatNumber(max)}${ctx.unit}`)
  if (value < min) lines.push(`▼ ${formatNumber(value)}${ctx.unit} is below min ${formatNumber(min)}${ctx.unit}`)
  return lines
}

function renderBullet(
  items: ChartBulletItem[],
  ctx: ChartContext,
  fallbackPoints: ChartPoint[],
  bands?: ChartBand[],
): string[] {
  const source: ChartBulletItem[] =
    items.length > 0 ? items : fallbackPoints.map((point, index): ChartBulletItem => ({ label: xLabel(point, index), value: point.value }))
  const clean = source.filter((item) => Number.isFinite(item.value))
  if (clean.length === 0) throw new Error("bullet chart needs at least one finite value")
  const notes: string[] = []
  const shown = clean.slice(0, MAX_BULLET_ITEMS)
  if (clean.length > MAX_BULLET_ITEMS) notes.push(`showing first ${MAX_BULLET_ITEMS} of ${clean.length} items`)
  const labelWidth = clamp(Math.max(...shown.map((item) => displayWidth(item.label))), 4, 18)
  const texts = shown.map((item) => {
    const reference = item.target ?? item.max
    return formatNumber(item.value) + (reference !== undefined ? "/" + formatNumber(reference) : "")
  })
  const valueWidth = Math.max(...texts.map((text) => displayWidth(text)))
  const trackWidth = ctx.width - labelWidth - valueWidth - 3
  if (trackWidth < 8) throw new Error(`bullet chart needs more width (have ${ctx.width}); shorten labels or drop units`)
  const rows = shown.map((item, index) => {
    const scaleMax = item.max ?? Math.max(item.value, item.target ?? 0) ?? 1
    const scale = scaleMax > 0 ? scaleMax : 1
    const cells: string[] = new Array(trackWidth).fill(" ")
    const filled = Math.max(item.value > 0 ? 1 : 0, Math.round(clamp(item.value / scale, 0, 1) * trackWidth))
    for (let x = 0; x < filled; x++) cells[x] = "█"
    for (const band of bands ?? []) {
      const x = Math.round(clamp(band.upTo, 0, 1) * (trackWidth - 1))
      cells[x] = "┆"
    }
    if (item.target !== undefined && Number.isFinite(item.target)) {
      const x = clamp(Math.round((item.target / scale) * (trackWidth - 1)), 0, trackWidth - 1)
      cells[x] = "╿"
    }
    const label = padRight(truncate(item.label, labelWidth), labelWidth)
    return label + " ┤" + cells.join("") + " " + padLeft(texts[index]!, valueWidth)
  })
  rows.push(...notes)
  return rows
}

function renderWaterfall(points: ChartPoint[], ctx: ChartContext, options: { height?: number; max?: number }): string[] {
  const data = finitePoints(points)
  if (data.length === 0) throw new Error("waterfall chart needs at least one finite value")
  const n = data.length
  const height = clamp(options.height ?? 8, 3, 14)
  const stride = Math.max(1, Math.floor(ctx.width / n))
  const columnWidth = stride >= 2 ? stride - 1 : 1
  const gap = stride >= 2 ? 1 : 0
  const used = n * columnWidth + (n - 1) * gap
  type Step = { from: number; to: number; kind: "abs" | "delta" | "total"; value: number }
  const steps: Step[] = []
  let running = 0
  data.forEach((point, index) => {
    const kind = point.type ?? (index === 0 ? "abs" : "delta")
    if (kind === "abs") {
      steps.push({ from: 0, to: point.value, kind, value: point.value })
      running = point.value
    } else if (kind === "total") {
      steps.push({ from: 0, to: running, kind, value: running })
    } else {
      steps.push({ from: running, to: running + point.value, kind, value: point.value })
      running += point.value
    }
  })
  const levels = steps.flatMap((step) => [step.from, step.to]).concat([0])
  const lo = Math.min(0, ...levels)
  const hi = Math.max(options.max ?? Math.max(...levels), lo + 1e-9)
  const grid: string[][] = Array.from({ length: height }, () => new Array(used).fill(" "))
  const levelRow = (value: number) => clamp(Math.round(height - ((value - lo) / (hi - lo)) * height), 0, height)
  steps.forEach((step, index) => {
    const x0 = index * (columnWidth + gap)
    const top = levelRow(Math.max(step.from, step.to))
    let bottom = levelRow(Math.min(step.from, step.to))
    if (bottom <= top && step.from !== step.to) bottom = Math.min(height, top + 1)
    const glyph = step.kind === "delta" && step.value < 0 ? "▒" : "█"
    for (let r = top; r < bottom; r++) {
      const cells = grid[r]!
      for (let x = x0; x < x0 + columnWidth; x++) cells[x] = glyph
    }
    if (index < n - 1) {
      const nextX = (index + 1) * (columnWidth + gap)
      const level = clamp(levelRow(step.to), 0, height - 1)
      const cells = grid[level]!
      for (let x = x0 + columnWidth; x < nextX; x += 2) {
        if (cells[x] === " ") cells[x] = "─"
      }
    }
  })
  const lines = grid.map((row) => row.join("").replace(/\s+$/, ""))
  const maxLabels = Math.max(1, Math.floor(used / 7))
  const labelEvery = Math.max(1, Math.ceil(n / maxLabels))
  const valueRow: string[] = new Array(used).fill(" ")
  const labelRow: string[] = new Array(used).fill(" ")
  const writeRow = (row: string[], start: number, text: string) => {
    let cursor = start
    for (const ch of text) {
      if (cursor >= used) break
      row[cursor] = ch
      cursor += 1
    }
  }
  for (let index = 0; index < n; index += labelEvery) {
    const step = steps[index]!
    const start = index * (columnWidth + gap)
    const slot = Math.max(3, labelEvery * stride - 1)
    const valueText = step.kind === "delta" ? `${step.value > 0 ? "+" : ""}${formatNumber(step.value)}` : formatNumber(step.value)
    writeRow(valueRow, start, truncate(valueText, slot))
    writeRow(labelRow, start, truncate(xLabel(data[index]!, index), slot))
  }
  lines.push(valueRow.join("").replace(/\s+$/, ""))
  lines.push(labelRow.join("").replace(/\s+$/, ""))
  return lines
}

function renderFunnel(points: ChartPoint[], ctx: ChartContext): string[] {
  const data = finitePoints(points)
  if (data.length === 0) throw new Error("funnel chart needs at least one finite value")
  const notes: string[] = []
  const shown = data.slice(0, MAX_FUNNEL_STAGES)
  if (data.length > MAX_FUNNEL_STAGES) notes.push(`showing first ${MAX_FUNNEL_STAGES} of ${data.length} stages`)
  const max = Math.max(...shown.map((point) => point.value), 1e-9)
  const labelWidth = clamp(Math.max(...shown.map((point, index) => displayWidth(xLabel(point, index)))), 4, 20)
  const stats = shown.map((point, index) => {
    if (index === 0) return formatNumber(point.value)
    const previous = shown[index - 1]!.value
    return previous > 0 ? `${formatNumber(point.value)} (${formatPct(point.value / previous, 0)})` : formatNumber(point.value)
  })
  const statsWidth = Math.max(...stats.map((text) => displayWidth(text)))
  const trackWidth = ctx.width - labelWidth - statsWidth - 3
  if (trackWidth < 6) throw new Error(`funnel chart needs more width (have ${ctx.width}); shorten stage names`)
  const rows = shown.map((point, index) => {
    const barWidth = point.value > 0 ? clamp(Math.round((point.value / max) * trackWidth), 1, trackWidth) : 0
    const inset = Math.floor((trackWidth - barWidth) / 2)
    const cells = " ".repeat(inset) + "█".repeat(barWidth) + " ".repeat(trackWidth - barWidth - inset)
    const prefix = padRight(truncate(xLabel(point, index), labelWidth), labelWidth) + "  "
    return prefix + cells + " " + padLeft(stats[index]!, statsWidth)
  })
  rows.push(...notes)
  return rows
}

function parseDayNumber(label: string | undefined): number | undefined {
  if (!label) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim())
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return date.getTime() / DAY_MS
}

function renderCalendar(points: ChartPoint[], ctx: ChartContext): string[] {
  const days = new Map<number, number>()
  let invalid = 0
  for (const point of points) {
    const dayNumber = parseDayNumber(point.label)
    if (dayNumber === undefined) {
      invalid += 1
      continue
    }
    if (Number.isFinite(point.value)) days.set(dayNumber, (days.get(dayNumber) ?? 0) + point.value)
  }
  if (days.size === 0) throw new Error("calendar heatmap needs data points with `label` set to a YYYY-MM-DD date")
  const dayNumbers = [...days.keys()]
  const minDay = Math.min(...dayNumbers)
  const maxDay = Math.max(...dayNumbers)
  const mondayIndex = (dayNumber: number) => (new Date(dayNumber * DAY_MS).getUTCDay() + 6) % 7
  const minWeek = minDay - mondayIndex(minDay)
  const maxWeek = maxDay - mondayIndex(maxDay)
  const weekCount = (maxWeek - minWeek) / 7 + 1
  const gutter = 4
  const available = Math.max(4, ctx.width - gutter)
  const shownWeeks = Math.min(weekCount, available)
  const omitted = weekCount - shownWeeks
  const firstWeek = minWeek + omitted * 7
  const maxValue = Math.max(0, ...days.values())
  const shades = ["░", "▒", "▓", "█"]
  const monthRow: string[] = new Array(Math.max(shownWeeks, 3)).fill(" ")
  let lastLabeled: string | undefined
  let lastMonthEnd = -1
  for (let week = 0; week < shownWeeks; week++) {
    const thursday = new Date((firstWeek + week * 7 + 3) * DAY_MS)
    const month = thursday.getUTCMonth()
    const key = `${thursday.getUTCFullYear()}-${month}`
    if (key === lastLabeled) continue
    const position = lastLabeled === undefined ? week : week + 1
    if (week >= lastMonthEnd + 1 && position + 3 <= monthRow.length) {
      const label = MONTHS[month]!
      for (let i = 0; i < 3; i++) monthRow[position + i] = label[i]!
      lastMonthEnd = position + 2
      lastLabeled = key
    }
  }
  const cellFor = (dayNumber: number): string => {
    if (dayNumber < minDay || dayNumber > maxDay) return " "
    const value = days.get(dayNumber)
    if (value === undefined) return " "
    if (value <= 0) return "·"
    return shades[clamp(Math.ceil((value / maxValue) * 4), 1, 4) - 1]!
  }
  const rows: string[] = []
  const monthLine = monthRow.join("").replace(/\s+$/, "")
  if (monthLine.length > 0) rows.push(" ".repeat(gutter) + monthLine)
  for (let offset = 0; offset < 7; offset++) {
    const cells: string[] = []
    for (let week = 0; week < shownWeeks; week++) {
      cells.push(cellFor(firstWeek + week * 7 + offset))
    }
    rows.push(padRight(WEEKDAYS[offset]!, gutter) + cells.join("").replace(/\s+$/, ""))
  }
  rows.push(`scale · 0 ░ ▒ ▓ █ ${formatNumber(maxValue)}${ctx.unit}`)
  if (omitted > 0) rows.push(`(+${omitted} earlier week${omitted === 1 ? "" : "s"} not shown)`)
  if (invalid > 0) rows.push(`skipped ${invalid} point${invalid === 1 ? "" : "s"} without a valid YYYY-MM-DD label`)
  return rows
}

export function renderChart(input: ChartInput, maxWidth: number): string[] {
  const ctx: ChartContext = { width: maxWidth, unit: input.unit ?? "" }
  let body: string[]
  if (input.chart === "heatmap") {
    body = renderHeatmap(input.rows ?? [], ctx)
  } else {
    const hasData =
      (input.data !== undefined && input.data.length > 0) ||
      (input.series !== undefined && input.series.length > 0) ||
      (input.values !== undefined && input.values.length > 0)
    const optionalSeries = input.chart === "gauge" || input.chart === "bullet"
    const series = hasData || !optionalSeries ? normalize(input) : []
    switch (input.chart) {
      case "bar":
        body = renderBar(series[0]!.points, ctx, input.max)
        break
      case "column": {
        const multi = input.stacked || input.percent || input.grouped || series.length > 1
        body = multi
          ? renderMultiColumns(series, ctx, {
              height: input.height,
              max: input.max,
              stacked: input.stacked,
              percent: input.percent,
              grouped: input.grouped,
            })
          : renderColumns(series[0]!.points, ctx, { height: input.height, max: input.max })
        break
      }
      case "line":
        body = renderCartesian(series, ctx, { height: input.height, max: input.max })
        break
      case "area":
        body = renderCartesian(series, ctx, { height: input.height, max: input.max, area: true })
        break
      case "scatter":
        body = renderCartesian(series, ctx, { height: input.height, max: input.max, scatter: true })
        break
      case "sparkline":
        body = renderSparkline(series, ctx)
        break
      case "donut":
        body = renderDonut(series[0]!.points, ctx, input.width)
        break
      case "histogram":
        body = renderHistogram(
          series[0]!.points.map((point) => point.value),
          ctx,
          input.bins,
          input.height,
        )
        break
      case "box":
        body = renderBoxPlot(series, ctx, { whiskers: input.whiskers, max: input.max })
        break
      case "gauge":
        body = renderGauge(series, ctx, {
          value: input.value,
          min: input.min,
          max: input.max,
          bands: input.bands,
          unit: ctx.unit,
          width: input.width,
        })
        break
      case "bullet":
        body = renderBullet(input.items ?? [], ctx, series[0]?.points ?? [], input.bands)
        break
      case "waterfall":
        body = renderWaterfall(series[0]!.points, ctx, { height: input.height, max: input.max })
        break
      case "funnel":
        body = renderFunnel(series[0]!.points, ctx)
        break
      case "calendar":
        body = renderCalendar(series[0]!.points, ctx)
        break
      default:
        throw new Error(`unknown chart type "${String(input.chart)}"`)
    }
  }
  return [...chartTitle(input, `${input.chart} chart`), ...body]
}
