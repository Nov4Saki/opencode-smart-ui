import { fmtCompact, fmtNum } from "../util.ts"
import {
  ACCENT,
  esc,
  FRAME,
  GRID,
  INK,
  INK_STRONG,
  legendRow,
  NEG,
  niceMax,
  numericRange,
  polarPoint,
  POS,
  seriesColor,
  svgDoc,
  topOffset,
  truncate,
  type DocOptions,
  type Series,
} from "./core.ts"

export const CHART_WIDTH = 640

export type ChartOptions = DocOptions & {
  unit?: string
  stacked?: boolean
  percent?: boolean
  area?: boolean
  height?: number
  alpha?: number
  radius?: number
  note?: string
}

function axisRange(values: number[]): { min: number; max: number } {
  let lo = 0
  let hi = 0
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (hi === 0 && lo === 0) return { min: 0, max: 1 }
  const min = lo < 0 ? -niceMax(-lo) : 0
  const max = hi > 0 ? niceMax(hi) : 1
  return { min, max }
}

export function signedGrid(opts: {
  x1: number
  x2: number
  top: number
  bottom: number
  min: number
  max: number
  unit?: string
}): string {
  const rows: string[] = []
  for (let i = 0; i <= 4; i++) {
    const value = opts.min + ((opts.max - opts.min) * i) / 4
    const y = opts.bottom - ((opts.bottom - opts.top) * i) / 4
    const zero = Math.abs(value) < 1e-9
    rows.push(
      `<line x1="${opts.x1}" y1="${y}" x2="${opts.x2}" y2="${y}" stroke="${zero ? FRAME : GRID}" stroke-opacity="${zero ? 0.7 : 0.3}" stroke-width="1"/>`,
    )
    if (!zero) {
      rows.push(
        `<text x="${opts.x1 - 6}" y="${y + 3.5}" font-size="10" fill="${INK}" text-anchor="end">${esc(axisLabel(value, opts.unit))}</text>`,
      )
    }
  }
  return rows.join("\n")
}

function axisLabel(value: number, unit?: string): string {
  const text = fmtCompact(value)
  return unit === "%" ? `${text}%` : unit ? `${text}${unit}` : text
}

function categoryLabels(labels: string[], x0: number, step: number, y: number): string {
  const every = labels.length > 0 ? Math.ceil(labels.length / Math.floor((step * labels.length) / 44)) : 1
  return labels
    .map((label, i) => {
      if (i % every !== 0 && i !== labels.length - 1) return ""
      const x = x0 + step * (i + 0.5)
      return `<text x="${x}" y="${y}" font-size="10" fill="${INK}" text-anchor="middle">${esc(truncate(label, 12))}</text>`
    })
    .filter(Boolean)
    .join("\n")
}

export function columnChart(labels: string[], series: Series[], opts: ChartOptions = {}): string {
  const stacked = opts.stacked === true || opts.percent === true
  const values = series.flatMap((s) => s.values)
  if (values.length === 0) return emptyDoc(opts)
  const percent = opts.percent === true
  const normalized = percent
    ? series.map((s) => ({
        ...s,
        values: s.values.map((v, i) => {
          const total = series.reduce((sum, entry) => sum + Math.max(0, entry.values[i] ?? 0), 0)
          return total > 0 ? (Math.max(0, v) / total) * 100 : 0
        }),
      }))
    : series
  const stackedSums = labels.map((_, i) =>
    stacked ? normalized.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0) : 0,
  )
  const range = stacked ? { min: 0, max: percent ? 100 : niceMax(Math.max(1, ...stackedSums)) } : axisRange(values)
  const height = opts.height ?? 260
  const top = topOffset(opts) + 10
  const legend = series.length > 1 || (series.length === 1 && !!series[0]!.name)
  const bottom = height - (legend ? 44 : 30)
  const x1 = 54
  const x2 = CHART_WIDTH - 16
  const plotW = x2 - x1
  const plotH = bottom - top
  if (labels.length === 0) return emptyDoc(opts)
  const step = plotW / labels.length
  const yFor = (v: number): number => bottom - ((v - range.min) / (range.max - range.min)) * plotH

  const body: string[] = [signedGrid({ x1, x2, top, bottom, min: range.min, max: range.max, unit: percent ? "%" : opts.unit })]

  if (stacked) {
    const barW = Math.min(52, step * 0.55)
    labels.forEach((_, i) => {
      let acc = 0
      normalized.forEach((s, si) => {
        const value = Math.max(0, s.values[i] ?? 0)
        const yTop = yFor(acc + value)
        const yBottom = yFor(acc)
        acc += value
        if (value <= 0) return
        body.push(
          `<rect x="${x1 + step * (i + 0.5) - barW / 2}" y="${yTop}" width="${barW}" height="${Math.max(0.5, yBottom - yTop)}" rx="2" fill="${seriesColor(si, s.color)}"/>`,
        )
      })
    })
  } else {
    const groupW = step * 0.72
    const barW = Math.min(46, groupW / series.length)
    labels.forEach((_, i) => {
      const groupX = x1 + step * (i + 0.5) - (barW * series.length) / 2
      series.forEach((s, si) => {
        const value = s.values[i] ?? 0
        const zeroY = yFor(0)
        const valueY = yFor(value)
        const y = Math.min(zeroY, valueY)
        const h = Math.max(0.5, Math.abs(valueY - zeroY))
        body.push(
          `<rect x="${groupX + si * barW}" y="${y}" width="${Math.max(2, barW - 3)}" height="${h}" rx="2" fill="${seriesColor(si, s.color)}"/>`,
        )
      })
    })
  }

  if (series.length === 1 && !stacked && !percent && labels.length <= 10) {
    const s = series[0]!
    labels.forEach((_, i) => {
      const value = s.values[i] ?? 0
      body.push(
        `<text x="${x1 + step * (i + 0.5)}" y="${yFor(value) - 5}" font-size="10" fill="${INK}" text-anchor="middle">${esc(fmtCompact(value))}</text>`,
      )
    })
  }

  body.push(categoryLabels(labels, x1, step, bottom + 16))
  if (legend) {
    body.push(
      legendRow({
        y: height - 12,
        entries: series.map((s, i) => ({ label: s.name ?? `Series ${i + 1}`, color: seriesColor(i, s.color) })),
      }),
    )
  }
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function barChart(items: { label: string; value: number }[], opts: ChartOptions = {}): string {
  if (items.length === 0) return emptyDoc(opts)
  const top = topOffset(opts) + 10
  const rowH = 26
  const height = opts.height ?? top + items.length * rowH + 14
  const labelW = Math.min(190, Math.max(90, ...items.map((item) => item.label.length * 7)))
  const x1 = labelW + 14
  const x2 = CHART_WIDTH - 64
  const max = niceMax(Math.max(1, ...items.map((item) => Math.max(0, item.value))))
  const body: string[] = []
  items.forEach((item, i) => {
    const y = top + i * rowH
    const trackW = x2 - x1
    const valueW = Math.max(2, (Math.max(0, item.value) / max) * trackW)
    body.push(
      `<text x="${labelW}" y="${y + 15}" font-size="11" fill="${INK}" text-anchor="end">${esc(truncate(item.label, Math.floor(labelW / 7)))}</text>`,
      `<rect x="${x1}" y="${y + 6}" width="${trackW}" height="13" rx="3" fill="${GRID}" fill-opacity="0.16"/>`,
      `<rect x="${x1}" y="${y + 6}" width="${valueW}" height="13" rx="3" fill="${seriesColor(i)}"/>`,
      `<text x="${x2 + 8}" y="${y + 16}" font-size="11" fill="${INK_STRONG}">${esc(axisLabel(item.value, opts.unit))}</text>`,
    )
  })
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function lineChart(labels: string[], series: Series[], opts: ChartOptions = {}): string {
  const values = series.flatMap((s) => s.values)
  if (values.length === 0) return emptyDoc(opts)
  const height = opts.height ?? 260
  const top = topOffset(opts) + 10
  const legend = series.length > 1 || (series.length === 1 && !!series[0]!.name)
  const bottom = height - (legend ? 44 : 30)
  const x1 = 54
  const x2 = CHART_WIDTH - 16
  const range = axisRange(values)
  const plotW = x2 - x1
  const plotH = bottom - top
  const count = Math.max(1, ...series.map((s) => s.values.length))
  const yFor = (v: number): number => bottom - ((v - range.min) / (range.max - range.min)) * plotH
  const xFor = (i: number): number => (count === 1 ? x1 + plotW / 2 : x1 + (plotW * i) / (count - 1))

  const body: string[] = [signedGrid({ x1, x2, top, bottom, min: range.min, max: range.max, unit: opts.unit })]

  series.forEach((s, si) => {
    const color = seriesColor(si, s.color)
    const points = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ")
    if (opts.area && si === 0) {
      const areaPath = `M ${xFor(0)},${yFor(0)} L ${s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" L ")} L ${xFor(s.values.length - 1)},${yFor(0)} Z`
      body.push(`<path d="${areaPath}" fill="${color}" fill-opacity="0.13" stroke="none"/>`)
    }
    body.push(
      `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    )
    if (s.values.length <= 24) {
      s.values.forEach((v, i) => {
        body.push(`<circle cx="${xFor(i)}" cy="${yFor(v)}" r="2.6" fill="${color}"/>`)
      })
    }
  })

  if (labels.length > 0) {
    const step = plotW / Math.max(1, labels.length)
    body.push(categoryLabels(labels, x1, step, bottom + 16))
  }
  if (legend) {
    body.push(
      legendRow({
        y: height - 12,
        entries: series.map((s, i) => ({ label: s.name ?? `Series ${i + 1}`, color: seriesColor(i, s.color) })),
      }),
    )
  }
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function donutChart(
  slices: { label: string; value: number }[],
  opts: ChartOptions & { centerLabel?: string } = {},
): string {
  if (slices.length === 0) return emptyDoc(opts)
  const top = topOffset(opts) + 6
  const height = Math.max(top + 196, top + slices.length * 26 + 20, opts.height ?? 0)
  const cx = 108
  const cy = top + 92
  const rOuter = 76
  const rInner = 51
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0)
  const body: string[] = []

  if (total <= 0) {
    body.push(`<circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="${GRID}" stroke-opacity="0.4" stroke-width="${rOuter - rInner}"/>`)
  } else {
    let angle = -90
    const gap = slices.length > 1 ? 1.4 : 0
    slices.forEach((slice, i) => {
      const fraction = Math.max(0, slice.value) / total
      const sweep = fraction * 360
      const start = angle + gap / 2
      const end = angle + sweep - gap / 2
      angle += sweep
      if (end <= start) return
      const large = end - start > 180 ? 1 : 0
      const p1 = polarPoint(cx, cy, rOuter, start)
      const p2 = polarPoint(cx, cy, rOuter, end)
      const p3 = polarPoint(cx, cy, rInner, end)
      const p4 = polarPoint(cx, cy, rInner, start)
      const d = [
        `M ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`,
        `A ${rOuter},${rOuter} 0 ${large} 1 ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`,
        `L ${p3.x.toFixed(2)},${p3.y.toFixed(2)}`,
        `A ${rInner},${rInner} 0 ${large} 0 ${p4.x.toFixed(2)},${p4.y.toFixed(2)}`,
        "Z",
      ].join(" ")
      body.push(`<path d="${d}" fill="${seriesColor(i)}"/>`)
    })
  }

  body.push(
    `<text x="${cx}" y="${cy + 2}" font-size="22" font-weight="600" fill="${INK_STRONG}" text-anchor="middle">${esc(fmtCompact(total))}</text>`,
    `<text x="${cx}" y="${cy + 20}" font-size="10" fill="${INK}" text-anchor="middle">${esc(opts.centerLabel ?? "total")}</text>`,
  )

  const legendX = 232
  slices.forEach((slice, i) => {
    const y = top + 18 + i * 26
    const pct = total > 0 ? Math.round((Math.max(0, slice.value) / total) * 100) : 0
    body.push(
      `<rect x="${legendX}" y="${y - 9}" width="10" height="10" rx="2" fill="${seriesColor(i)}"/>`,
      `<text x="${legendX + 18}" y="${y}" font-size="12" fill="${INK_STRONG}">${esc(truncate(slice.label, 34))}</text>`,
      `<text x="${CHART_WIDTH - 16}" y="${y}" font-size="12" fill="${INK}" text-anchor="end">${esc(fmtCompact(slice.value))}${opts.unit && opts.unit !== "%" ? esc(opts.unit) : ""} · ${pct}%</text>`,
    )
  })
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function gaugeChart(
  value: number,
  opts: ChartOptions & { min?: number; max?: number; label?: string; bands?: { upTo: number; label?: string }[] } = {},
): string {
  const min = opts.min ?? 0
  const max = opts.max ?? 100
  const span = max - min || 1
  const clamped = Math.min(max, Math.max(min, value))
  const fraction = (clamped - min) / span
  const top = topOffset(opts) + 12
  const height = Math.max(opts.height ?? 0, top + 186)
  const cx = CHART_WIDTH / 2
  const cy = top + 118
  const radius = 96
  const stroke = 16
  const body: string[] = []

  const p1 = polarPoint(cx, cy, radius, 180)
  const p2 = polarPoint(cx, cy, radius, 360)
  body.push(
    `<path d="M ${p1.x},${p1.y} A ${radius},${radius} 0 0 1 ${p2.x},${p2.y}" fill="none" stroke="${GRID}" stroke-opacity="0.22" stroke-width="${stroke}" stroke-linecap="round"/>`,
  )

  if (fraction > 0.001) {
    const pe = polarPoint(cx, cy, radius, 180 + 180 * fraction)
    const large = 180 * fraction > 180 ? 1 : 0
    body.push(
      `<path d="M ${p1.x},${p1.y} A ${radius},${radius} 0 ${large} 1 ${pe.x.toFixed(2)},${pe.y.toFixed(2)}" fill="none" stroke="${seriesColor(0)}" stroke-width="${stroke}" stroke-linecap="round"/>`,
    )
  }

  for (const band of opts.bands ?? []) {
    const bandFraction = Math.min(1, Math.max(0, (band.upTo - min) / span))
    const tickOuter = polarPoint(cx, cy, radius + stroke / 2 + 3, 180 + 180 * bandFraction)
    const tickInner = polarPoint(cx, cy, radius - stroke / 2 - 3, 180 + 180 * bandFraction)
    body.push(
      `<line x1="${tickInner.x.toFixed(2)}" y1="${tickInner.y.toFixed(2)}" x2="${tickOuter.x.toFixed(2)}" y2="${tickOuter.y.toFixed(2)}" stroke="${INK}" stroke-width="1.5"/>`,
    )
    if (band.label) {
      const labelPos = polarPoint(cx, cy, radius + 22, 180 + 180 * bandFraction)
      body.push(
        `<text x="${labelPos.x.toFixed(2)}" y="${labelPos.y.toFixed(2)}" font-size="9" fill="${INK}" text-anchor="middle">${esc(truncate(band.label, 12))}</text>`,
      )
    }
  }

  const needleAngle = 180 + 180 * fraction
  const needleTip = polarPoint(cx, cy, radius - stroke - 12, needleAngle)
  body.push(
    `<line x1="${cx}" y1="${cy}" x2="${needleTip.x.toFixed(2)}" y2="${needleTip.y.toFixed(2)}" stroke="${INK_STRONG}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${INK_STRONG}"/>`,
    `<text x="${cx}" y="${cy - 26}" font-size="30" font-weight="700" fill="${INK_STRONG}" text-anchor="middle">${esc(fmtNum(clamped))}${esc(opts.unit === "%" || !opts.unit ? "%" : opts.unit)}</text>`,
    `<text x="${cx - radius}" y="${cy + 20}" font-size="10" fill="${INK}" text-anchor="middle">${esc(fmtCompact(min))}</text>`,
    `<text x="${cx + radius}" y="${cy + 20}" font-size="10" fill="${INK}" text-anchor="middle">${esc(fmtCompact(max))}</text>`,
  )
  if (opts.label) {
    body.push(`<text x="${cx}" y="${cy + 42}" font-size="12" fill="${INK}" text-anchor="middle">${esc(truncate(opts.label, 46))}</text>`)
  }
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function sparklineChart(values: number[], opts: ChartOptions = {}): string {
  if (values.length === 0) return emptyDoc(opts)
  const top = topOffset(opts) + 6
  const height = opts.height ?? top + 46
  const x1 = 16
  const x2 = CHART_WIDTH - 16
  const bottom = height - 8
  const range = axisRange(values)
  const span = range.max - range.min || 1
  const xFor = (i: number): number => (values.length === 1 ? (x1 + x2) / 2 : x1 + ((x2 - x1) * i) / (values.length - 1))
  const yFor = (v: number): number => bottom - ((v - range.min) / span) * (bottom - top)
  const color = seriesColor(0)
  const line = values.map((v, i) => `${xFor(i).toFixed(2)},${yFor(v).toFixed(2)}`).join(" ")
  const areaPath = `M ${xFor(0).toFixed(2)},${bottom} L ${values.map((v, i) => `${xFor(i).toFixed(2)},${yFor(v).toFixed(2)}`).join(" L ")} L ${xFor(values.length - 1).toFixed(2)},${bottom} Z`
  const last = values[values.length - 1]!
  const body = [
    `<path d="${areaPath}" fill="${color}" fill-opacity="0.13" stroke="none"/>`,
    `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<circle cx="${xFor(values.length - 1).toFixed(2)}" cy="${yFor(last).toFixed(2)}" r="3" fill="${color}"/>`,
  ]
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function scatterChart(
  series: { name?: string; points: [number, number][]; color?: string }[],
  opts: ChartOptions = {},
): string {
  const all = series.flatMap((entry) => entry.points).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  if (all.length === 0) return emptyDoc(opts)
  const xRange = numericRange(all.map((point) => point[0]))
  const yRange = numericRange(all.map((point) => point[1]))
  const height = opts.height ?? 260
  const top = topOffset(opts) + 10
  const legend = series.length > 1 || (series.length === 1 && !!series[0]!.name)
  const bottom = height - (legend ? 44 : 30)
  const x1 = 58
  const x2 = CHART_WIDTH - 18
  const plotW = x2 - x1
  const plotH = bottom - top
  const xFor = (value: number): number => x1 + ((value - xRange.min) / (xRange.max - xRange.min)) * plotW
  const yFor = (value: number): number => bottom - ((value - yRange.min) / (yRange.max - yRange.min)) * plotH
  const body: string[] = [signedGrid({ x1, x2, top, bottom, min: yRange.min, max: yRange.max, unit: opts.unit })]
  for (let i = 0; i <= 4; i++) {
    const value = xRange.min + ((xRange.max - xRange.min) * i) / 4
    body.push(
      `<text x="${xFor(value).toFixed(2)}" y="${bottom + 16}" font-size="10" fill="${INK}" text-anchor="middle">${esc(fmtCompact(value))}</text>`,
    )
  }
  const alpha =
    typeof opts.alpha === "number" && Number.isFinite(opts.alpha) ? Math.min(1, Math.max(0.02, opts.alpha)) : 0.85
  const radius =
    typeof opts.radius === "number" && Number.isFinite(opts.radius) ? Math.min(6, Math.max(0.6, opts.radius)) : 3.2
  if (opts.note) {
    body.push(
      `<text x="${x2}" y="${top - 6}" font-size="10" fill="${INK}" text-anchor="end">${esc(opts.note)}</text>`,
    )
  }
  series.forEach((entry, si) => {
    const color = seriesColor(si, entry.color)
    for (const [px, py] of entry.points) {
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue
      body.push(
        `<circle cx="${xFor(px).toFixed(2)}" cy="${yFor(py).toFixed(2)}" r="${radius}" fill="${color}" fill-opacity="${alpha}"/>`,
      )
    }
  })
  if (legend) {
    body.push(
      legendRow({
        y: height - 12,
        entries: series.map((entry, i) => ({ label: entry.name ?? `Series ${i + 1}`, color: seriesColor(i, entry.color) })),
      }),
    )
  }
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function waterfallChart(items: { label: string; value: number }[], opts: ChartOptions = {}): string {
  if (items.length === 0) return emptyDoc(opts)
  const bars: { label: string; value: number; from: number; to: number; total: boolean }[] = []
  let running = 0
  for (const item of items) {
    bars.push({ label: item.label, value: item.value, from: running, to: running + item.value, total: false })
    running += item.value
  }
  bars.push({ label: "total", value: running, from: 0, to: running, total: true })
  const height = opts.height ?? 260
  const top = topOffset(opts) + 10
  const bottom = height - 30
  const x1 = 58
  const x2 = CHART_WIDTH - 16
  let lo = 0
  let hi = 0
  for (const bar of bars) {
    lo = Math.min(lo, bar.from, bar.to)
    hi = Math.max(hi, bar.from, bar.to)
  }
  const range = { min: lo < 0 ? -niceMax(-lo) : 0, max: niceMax(hi || 1) }
  const yFor = (value: number): number => bottom - ((value - range.min) / (range.max - range.min)) * (bottom - top)
  const step = (x2 - x1) / bars.length
  const barW = Math.min(46, step * 0.62)
  const body: string[] = [signedGrid({ x1, x2, top, bottom, min: range.min, max: range.max, unit: opts.unit })]
  let previousTo: number | undefined
  bars.forEach((bar, i) => {
    const center = x1 + step * (i + 0.5)
    const yTop = yFor(Math.max(bar.from, bar.to))
    const yBottom = yFor(Math.min(bar.from, bar.to))
    const color = bar.total ? ACCENT : bar.value < 0 ? NEG : POS
    body.push(
      `<rect x="${(center - barW / 2).toFixed(2)}" y="${yTop.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(1, yBottom - yTop).toFixed(2)}" rx="2" fill="${color}"/>`,
    )
    if (previousTo !== undefined) {
      const y = yFor(previousTo)
      body.push(
        `<line x1="${(center - step / 2).toFixed(2)}" y1="${y.toFixed(2)}" x2="${(center - barW / 2).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${INK}" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.7"/>`,
      )
    }
    previousTo = bar.to
    const sign = bar.total || bar.value < 0 ? "" : "+"
    body.push(
      `<text x="${center.toFixed(2)}" y="${(yTop - 5).toFixed(2)}" font-size="10" fill="${INK}" text-anchor="middle">${esc(`${sign}${fmtCompact(bar.value)}`)}</text>`,
    )
  })
  body.push(categoryLabels(bars.map((bar) => bar.label), x1, step, bottom + 16))
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

function mixHex(from: string, to: string, t: number): string {
  const parts = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [r1, g1, b1] = parts(from)
  const [r2, g2, b2] = parts(to)
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * t)
  return `#${[mix(r1!, r2!), mix(g1!, g2!), mix(b1!, b2!)].map((n) => n.toString(16).padStart(2, "0")).join("")}`
}

export function heatmapChart(
  values: number[][],
  opts: ChartOptions & { rowLabels?: string[]; columnLabels?: string[] } = {},
): string {
  const rowCount = values.length
  const columnCount = Math.max(0, ...values.map((row) => row.length))
  if (rowCount === 0 || columnCount === 0) return emptyDoc(opts)
  const flat = values.flat().filter((value) => Number.isFinite(value))
  const lo = Math.min(0, ...flat)
  const hi = Math.max(1, ...flat)
  const labelWidth = Math.min(120, Math.max(0, ...(opts.rowLabels ?? []).map((label) => label.length * 6.2)))
  const top = topOffset(opts) + (opts.columnLabels ? 18 : 6)
  const height = opts.height ?? Math.max(top + 40, top + rowCount * 22 + 8)
  const x1 = 16 + labelWidth
  const x2 = CHART_WIDTH - 16
  const bottom = height - 8
  const cellW = (x2 - x1) / columnCount
  const cellH = (bottom - top) / rowCount
  const body: string[] = []
  if (opts.columnLabels) {
    for (let c = 0; c < columnCount; c++) {
      const label = opts.columnLabels[c]
      if (label === undefined) continue
      body.push(
        `<text x="${(x1 + cellW * (c + 0.5)).toFixed(2)}" y="${top - 6}" font-size="9" fill="${INK}" text-anchor="middle">${esc(truncate(label, Math.max(2, Math.floor(cellW / 5.4))))}</text>`,
      )
    }
  }
  values.forEach((row, r) => {
    if (opts.rowLabels?.[r] !== undefined) {
      body.push(
        `<text x="${(x1 - 8).toFixed(2)}" y="${(top + cellH * (r + 0.5) + 3.5).toFixed(2)}" font-size="10" fill="${INK}" text-anchor="end">${esc(truncate(opts.rowLabels![r]!, Math.floor(Math.max(0, labelWidth) / 6.2)))}</text>`,
      )
    }
    for (let c = 0; c < columnCount; c++) {
      const value = row[c]
      const x = x1 + cellW * c
      const y = top + cellH * r
      if (value === undefined || !Number.isFinite(value)) continue
      const t = (value - lo) / (hi - lo || 1)
      body.push(
        `<rect x="${(x + 1).toFixed(2)}" y="${(y + 1).toFixed(2)}" width="${Math.max(1, cellW - 2).toFixed(2)}" height="${Math.max(1, cellH - 2).toFixed(2)}" rx="2" fill="${mixHex("#232a36", ACCENT, Math.min(1, Math.max(0, t)))}"/>`,
      )
      if (cellW > 34 && cellH > 16) {
        body.push(
          `<text x="${(x + cellW / 2).toFixed(2)}" y="${(y + cellH / 2 + 3.5).toFixed(2)}" font-size="9" fill="#eef2f8" fill-opacity="${t > 0.45 ? 0.95 : 0.6}" text-anchor="middle">${esc(fmtCompact(value))}</text>`,
        )
      }
    }
  })
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function radarChart(axes: string[], series: Series[], opts: ChartOptions & { max?: number } = {}): string {
  if (axes.length < 3 || series.length === 0) return emptyDoc(opts)
  const max =
    opts.max ??
    niceMax(Math.max(1, ...series.flatMap((entry) => entry.values.slice(0, axes.length).map((value) => Math.abs(value)))))
  const top = topOffset(opts) + 8
  const height = opts.height ?? top + 216
  const cx = CHART_WIDTH / 2
  const cy = top + 104
  const radius = 88
  const body: string[] = []
  for (let ring = 1; ring <= 4; ring++) {
    const r = (radius * ring) / 4
    const points = axes
      .map((_, i) => polarPoint(cx, cy, r, -90 + (360 * i) / axes.length))
      .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(" ")
    body.push(
      `<polygon points="${points}" fill="none" stroke="${GRID}" stroke-opacity="${ring === 4 ? 0.5 : 0.22}" stroke-width="1"/>`,
    )
  }
  axes.forEach((axis, i) => {
    const angle = -90 + (360 * i) / axes.length
    const tip = polarPoint(cx, cy, radius, angle)
    body.push(
      `<line x1="${cx}" y1="${cy}" x2="${tip.x.toFixed(2)}" y2="${tip.y.toFixed(2)}" stroke="${GRID}" stroke-opacity="0.3" stroke-width="1"/>`,
    )
    const labelPos = polarPoint(cx, cy, radius + 16, angle)
    const anchor = labelPos.x < cx - 6 ? "end" : labelPos.x > cx + 6 ? "start" : "middle"
    body.push(
      `<text x="${labelPos.x.toFixed(2)}" y="${labelPos.y.toFixed(2)}" font-size="10" fill="${INK}" text-anchor="${anchor}">${esc(truncate(axis, 14))}</text>`,
    )
  })
  series.forEach((entry, si) => {
    const color = seriesColor(si, entry.color)
    const points = axes
      .map((_, i) => {
        const value = Math.min(max, Math.max(0, entry.values[i] ?? 0))
        const point = polarPoint(cx, cy, (value / max) * radius, -90 + (360 * i) / axes.length)
        return `${point.x.toFixed(2)},${point.y.toFixed(2)}`
      })
      .join(" ")
    body.push(
      `<polygon points="${points}" fill="${color}" fill-opacity="0.13" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>`,
    )
    axes.forEach((_, i) => {
      const value = Math.min(max, Math.max(0, entry.values[i] ?? 0))
      const point = polarPoint(cx, cy, (value / max) * radius, -90 + (360 * i) / axes.length)
      body.push(`<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="2.4" fill="${color}"/>`)
    })
  })
  body.push(
    `<text x="${cx}" y="${cy + 3}" font-size="9" fill="${INK}" text-anchor="middle">max ${esc(fmtCompact(max))}</text>`,
  )
  if (series.length > 1 || (series.length === 1 && !!series[0]!.name)) {
    body.push(
      legendRow({
        y: height - 10,
        entries: series.map((entry, i) => ({ label: entry.name ?? `Series ${i + 1}`, color: seriesColor(i, entry.color) })),
      }),
    )
  }
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

function whenLabel(value: number, dates?: boolean): string {
  if (!dates) return fmtCompact(value)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fmtCompact(value)
  return date.toISOString().slice(0, 10)
}

export function timelineChart(
  items: { label: string; start: number; end: number }[],
  opts: ChartOptions & { dates?: boolean } = {},
): string {
  if (items.length === 0) return emptyDoc(opts)
  const top = topOffset(opts) + 14
  const height = opts.height ?? top + items.length * 26 + 24
  const bottom = height - 28
  const labelWidth = Math.min(190, Math.max(90, ...items.map((item) => item.label.length * 7)))
  const x1 = labelWidth + 14
  const x2 = CHART_WIDTH - 16
  const lo = Math.min(...items.map((item) => Math.min(item.start, item.end)))
  const hi = Math.max(...items.map((item) => Math.max(item.start, item.end)))
  const range = hi > lo ? { min: lo, max: hi } : { min: lo - 1, max: hi + 1 }
  const xFor = (value: number): number => x1 + ((value - range.min) / (range.max - range.min)) * (x2 - x1)
  const body: string[] = []
  for (let i = 0; i <= 4; i++) {
    const value = range.min + ((range.max - range.min) * i) / 4
    const x = xFor(value)
    body.push(
      `<line x1="${x.toFixed(2)}" y1="${top - 4}" x2="${x.toFixed(2)}" y2="${bottom + 2}" stroke="${GRID}" stroke-opacity="0.22" stroke-width="1"/>`,
      `<text x="${x.toFixed(2)}" y="${bottom + 16}" font-size="10" fill="${INK}" text-anchor="middle">${esc(whenLabel(value, opts.dates))}</text>`,
    )
  }
  items.forEach((item, i) => {
    const y = top + i * 26
    const left = xFor(Math.min(item.start, item.end))
    const right = xFor(Math.max(item.start, item.end))
    body.push(
      `<text x="${labelWidth}" y="${y + 15}" font-size="11" fill="${INK}" text-anchor="end">${esc(truncate(item.label, Math.floor(labelWidth / 7)))}</text>`,
      `<rect x="${left.toFixed(2)}" y="${y + 5}" width="${Math.max(3, right - left).toFixed(2)}" height="14" rx="3" fill="${seriesColor(i)}" fill-opacity="0.9"/>`,
    )
  })
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function funnelChart(items: { label: string; value: number }[], opts: ChartOptions = {}): string {
  if (items.length === 0) return emptyDoc(opts)
  const top = topOffset(opts) + 10
  const rowH = 30
  const height = opts.height ?? top + items.length * rowH + 16
  const max = Math.max(1, ...items.map((item) => Math.max(0, item.value)))
  const first = Math.max(1, items[0]?.value ?? 1)
  const cx = CHART_WIDTH / 2
  const maxWidth = CHART_WIDTH - 200
  const body: string[] = []
  items.forEach((item, i) => {
    const y = top + i * rowH
    const value = Math.max(0, item.value)
    const width = Math.max(6, (value / max) * maxWidth)
    const pct = Math.round((value / first) * 100)
    body.push(
      `<rect x="${(cx - width / 2).toFixed(2)}" y="${y + 4}" width="${width.toFixed(2)}" height="18" rx="3" fill="${seriesColor(i)}" fill-opacity="0.9"/>`,
      `<text x="${(cx - width / 2 - 8).toFixed(2)}" y="${y + 17}" font-size="11" fill="${INK}" text-anchor="end">${esc(truncate(item.label, 18))}</text>`,
      `<text x="${(cx + width / 2 + 8).toFixed(2)}" y="${y + 17}" font-size="11" fill="${INK_STRONG}" text-anchor="start">${esc(fmtCompact(value))}${opts.unit ? esc(opts.unit) : ""} · ${pct}%</text>`,
    )
  })
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function progressChart(
  value: number,
  opts: ChartOptions & { max?: number; bands?: { upTo: number; label?: string }[]; label?: string } = {},
): string {
  const min = 0
  const max = opts.max ?? 100
  const span = max - min || 1
  const clamped = Math.min(max, Math.max(min, value))
  const fraction = (clamped - min) / span
  const top = topOffset(opts) + 16
  const height = Math.max(opts.height ?? 0, top + 92)
  const x1 = 16
  const x2 = CHART_WIDTH - 16
  const y = top + 34
  const trackH = 18
  const unit = opts.unit === undefined || opts.unit === "%" ? "%" : opts.unit
  const pct = Math.round(fraction * 100)
  const body: string[] = [
    `<text x="${x1}" y="${top + 10}" font-size="26" font-weight="700" fill="${INK_STRONG}">${esc(fmtNum(clamped))}${esc(unit)}</text>`,
    `<text x="${x2}" y="${top + 10}" font-size="11" fill="${INK}" text-anchor="end">${esc(opts.label ?? `${pct}% of ${fmtCompact(max)}`)}</text>`,
    `<rect x="${x1}" y="${y}" width="${x2 - x1}" height="${trackH}" rx="9" fill="${GRID}" fill-opacity="0.18"/>`,
    `<rect x="${x1}" y="${y}" width="${Math.max(0, (x2 - x1) * fraction).toFixed(2)}" height="${trackH}" rx="9" fill="${ACCENT}"/>`,
  ]
  for (const band of opts.bands ?? []) {
    const bx = x1 + ((Math.min(max, Math.max(min, band.upTo)) - min) / span) * (x2 - x1)
    body.push(
      `<line x1="${bx.toFixed(2)}" y1="${y - 3}" x2="${bx.toFixed(2)}" y2="${y + trackH + 3}" stroke="${INK}" stroke-width="1.5"/>`,
    )
    if (band.label) {
      body.push(
        `<text x="${bx.toFixed(2)}" y="${y + trackH + 16}" font-size="9" fill="${INK}" text-anchor="middle">${esc(truncate(band.label, 12))}</text>`,
      )
    }
  }
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

function layoutTreemap(
  values: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  out: { x: number; y: number; w: number; h: number }[],
): void {
  if (values.length === 0) return
  if (values.length === 1) {
    out.push({ x, y, w, h })
    return
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) {
    for (let i = 0; i < values.length; i++) out.push({ x, y, w: 0, h: 0 })
    return
  }
  let acc = 0
  let split = 1
  for (let i = 0; i < values.length; i++) {
    acc += values[i]!
    if (acc >= total / 2) {
      split = i + 1
      break
    }
  }
  const fraction = acc / total
  if (w >= h) {
    const w1 = w * fraction
    layoutTreemap(values.slice(0, split), x, y, w1, h, out)
    layoutTreemap(values.slice(split), x + w1, y, w - w1, h, out)
  } else {
    const h1 = h * fraction
    layoutTreemap(values.slice(0, split), x, y, w, h1, out)
    layoutTreemap(values.slice(split), x, y + h1, w, h - h1, out)
  }
}

export function treemapChart(items: { label: string; value: number }[], opts: ChartOptions = {}): string {
  const positive = items.filter((item) => Number.isFinite(item.value) && item.value > 0)
  if (positive.length === 0) return emptyDoc(opts)
  const sorted = [...positive].sort((a, b) => b.value - a.value)
  const top = topOffset(opts) + 8
  const height = opts.height ?? top + 192
  const x1 = 16
  const x2 = CHART_WIDTH - 16
  const bottom = height - 10
  const rects: { x: number; y: number; w: number; h: number }[] = []
  layoutTreemap(sorted.map((item) => item.value), x1, top, x2 - x1, bottom - top, rects)
  const total = sorted.reduce((sum, item) => sum + item.value, 0)
  const body: string[] = []
  sorted.forEach((item, i) => {
    const rect = rects[i]!
    if (!rect || rect.w < 2 || rect.h < 2) return
    body.push(
      `<rect x="${(rect.x + 1).toFixed(2)}" y="${(rect.y + 1).toFixed(2)}" width="${(rect.w - 2).toFixed(2)}" height="${(rect.h - 2).toFixed(2)}" rx="3" fill="${seriesColor(i)}" fill-opacity="0.85"/>`,
    )
    if (rect.w > 46 && rect.h > 18) {
      body.push(
        `<text x="${(rect.x + 8).toFixed(2)}" y="${(rect.y + 16).toFixed(2)}" font-size="10" font-weight="600" fill="#f4f6fa">${esc(truncate(item.label, Math.floor((rect.w - 16) / 6)))}</text>`,
      )
    }
    if (rect.w > 46 && rect.h > 32) {
      const share = Math.round((item.value / total) * 100)
      body.push(
        `<text x="${(rect.x + 8).toFixed(2)}" y="${(rect.y + 30).toFixed(2)}" font-size="10" fill="#e6ebf2" fill-opacity="0.85">${esc(fmtCompact(item.value))} · ${share}%</text>`,
      )
    }
  })
  return svgDoc(CHART_WIDTH, height, body.join("\n"), opts)
}

export function emptyDoc(opts: DocOptions): string {
  const top = topOffset(opts)
  return svgDoc(
    CHART_WIDTH,
    top + 60,
    `<text x="16" y="${top + 30}" font-size="12" fill="${INK}">no data</text>`,
    opts,
  )
}
