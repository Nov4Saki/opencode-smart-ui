import { newId } from "./state.ts"
import { fmtCompact } from "./util.ts"
import type { Surface } from "./options.ts"
import type { ChartPublisher } from "./server.ts"
import {
  barArt,
  columnArt,
  donutArt,
  funnelArt,
  gaugeArt,
  heatmapArt,
  progressArt,
  radarArt,
  scatterArt,
  sparklineArt,
  timelineArt,
  treemapArt,
  waterfallArt,
} from "./art/fallback.ts"
import {
  loadDataset,
  numericColumn,
  textColumn,
  type Dataset,
  type SourceSpec,
} from "./data-source.ts"
import {
  barChart,
  columnChart,
  donutChart,
  funnelChart,
  gaugeChart,
  heatmapChart,
  lineChart,
  progressChart,
  radarChart,
  scatterChart,
  sparklineChart,
  timelineChart,
  treemapChart,
  waterfallChart,
  type ChartOptions,
} from "./svg/charts.ts"
import { artFence, urlPayload } from "./svg/payload.ts"
import { badgesMarkdown, calloutMarkdown, checklistMarkdown, kvMarkdown, quoteMarkdown, statsMarkdown, tableMarkdown } from "./svg/panels.ts"

export const ELEMENTS = [
  "bar",
  "column",
  "line",
  "area",
  "donut",
  "sparkline",
  "gauge",
  "scatter",
  "waterfall",
  "heatmap",
  "radar",
  "timeline",
  "funnel",
  "progress",
  "treemap",
  "stats",
  "kv",
  "table",
  "checklist",
  "callout",
  "badges",
  "quote",
] as const

const CHART_ELEMENTS = new Set([
  "bar",
  "column",
  "line",
  "area",
  "donut",
  "sparkline",
  "gauge",
  "scatter",
  "waterfall",
  "heatmap",
  "radar",
  "timeline",
  "funnel",
  "progress",
  "treemap",
])

function fail(message: string): never {
  throw new Error(message)
}

function cap<T>(list: T[] | undefined, max: number, what: string): T[] | undefined {
  if (!list) return undefined
  if (list.length > max) fail(`${what} supports at most ${max} entries (got ${list.length})`)
  return list
}

type ScatterPoint = [number, number]

type SeriesLike = { name?: string; values?: number[]; points?: ScatterPoint[] }

function seriesList(args: { series?: SeriesLike[]; values?: number[] }): { name?: string; values: number[] }[] {
  if (args.series && args.series.length > 0) {
    return args.series
      .filter((entry) => Array.isArray(entry?.values))
      .map((entry) => ({ name: entry.name, values: entry.values! }))
  }
  if (args.values && args.values.length > 0) return [{ values: args.values }]
  return []
}

function requireLabels(args: { labels?: string[] }): string[] {
  if (!args.labels || args.labels.length === 0) fail("this chart needs `labels` (category names)")
  return args.labels!
}

function requireSeries(args: { series?: SeriesLike[]; values?: number[] }): { name?: string; values: number[] }[] {
  const series = seriesList(args)
  if (series.length === 0) fail("this chart needs `series` (or `values` for a single unnamed series)")
  for (const entry of series) {
    if (entry.values.length === 0) fail("every series needs at least one value")
  }
  return series
}

function requireData(args: { data?: { label: string; value: number }[] }, what: string): { label: string; value: number }[] {
  const data = cap(args.data, 64, "data")
  if (!data || data.length === 0) fail(`${what} needs a non-empty \`data\` array of {label, value}`)
  return data!
}

type ShowArgs = {
  element: (typeof ELEMENTS)[number]
  title?: string
  subtitle?: string
  unit?: string
  height?: number
  labels?: string[]
  series?: SeriesLike[]
  data?: { label: string; value: number }[]
  values?: number[]
  value?: number | string
  min?: number
  max?: number
  bands?: { upTo: number; label?: string }[]
  stacked?: boolean
  percent?: boolean | number
  area?: boolean
  alpha?: number
  columns?: string[]
  rows?: (string | number)[][]
  align?: ("l" | "c" | "r")[]
  matrix?: number[][]
  rowLabels?: string[]
  columnLabels?: string[]
  spans?: { label: string; start: number; end: number }[]
  dates?: boolean
  source?: SourceSpec
  label?: string | number
  row?: string | number
  column?: string | number
  x?: string | number
  y?: string | number
  group?: string | number
  start?: string | number
  end?: string | number
  axis?: string | number
  items?: {
    label?: string
    name?: string
    value?: string | number
    unit?: string
    delta?: string
    trend?: "up" | "down" | "flat"
    status?: "todo" | "doing" | "done" | "blocked" | "skipped"
    detail?: string
  }[]
  level?: "info" | "success" | "warning" | "error" | "tip"
  body?: string
  text?: string
  attribution?: string
}

function chartOptions(args: ShowArgs): ChartOptions {
  return { title: args.title, subtitle: args.subtitle, unit: args.unit, height: args.height, alpha: args.alpha }
}

function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
}

function numberList(input: unknown): number[] | undefined {
  if (Array.isArray(input)) return input.map((value) => (typeof value === "number" ? value : Number(value)))
  if (typeof input === "string") {
    const parts = input.split(/[,\s]+/).map((part) => part.trim()).filter((part) => part !== "")
    if (parts.length === 0) return undefined
    return parts.map((part) => Number(part))
  }
  return undefined
}

function pointsList(input: unknown): ScatterPoint[] | undefined {
  if (Array.isArray(input)) return input as ScatterPoint[]
  if (typeof input !== "string") return undefined
  const pairs = input.split(/[;|]/).map((chunk) => chunk.trim()).filter((chunk) => chunk !== "")
  const points: ScatterPoint[] = []
  for (const pair of pairs) {
    const [rawX, rawY] = pair.split(/[,:\s]+/)
    points.push([Number(rawX), Number(rawY)])
  }
  return points
}

function normalizeCompact(args: ShowArgs): void {
  const raw = args as Record<string, unknown>
  if (typeof raw.labels === "string") raw.labels = splitList(raw.labels)
  if (typeof raw.values === "string") raw.values = numberList(raw.values)
  if (Array.isArray(raw.series)) {
    raw.series = (raw.series as unknown[]).map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry
      const record = entry as Record<string, unknown>
      const next: Record<string, unknown> = { ...record }
      if (typeof record.values === "string") next.values = numberList(record.values)
      if (typeof record.points === "string") next.points = pointsList(record.points)
      return next
    })
  }
  if (typeof raw.data === "string") {
    raw.data = raw.data
      .split(/[,\n]/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk !== "")
      .map((chunk) => {
        const cut = chunk.lastIndexOf(":")
        if (cut < 0) fail(`compact \`data\` entries must look like "Label: 3" (got "${chunk}")`)
        return { label: chunk.slice(0, cut).trim(), value: Number(chunk.slice(cut + 1).trim()) }
      })
  }
  if (typeof raw.spans === "string") {
    raw.spans = raw.spans
      .split(/[;\n]/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk !== "")
      .map((chunk) => {
        const [label, start, end] = chunk.split(":")
        return { label: (label ?? "").trim(), start: Number(start), end: Number(end) }
      })
  }
}

function applySource(element: string, args: ShowArgs, dataset: Dataset): void {
  const pickLabels = (): string[] => textColumn(dataset, args.label ?? 0, "label")
  const pickValues = (): number[] => numericColumn(dataset, args.value ?? 1, "value")
  switch (element) {
    case "bar":
    case "donut":
    case "waterfall":
    case "funnel":
    case "treemap": {
      const labels = pickLabels()
      const values = pickValues()
      args.data = labels.map((label, i) => ({ label, value: values[i] ?? 0 }))
      break
    }
    case "column":
    case "line":
    case "area":
    case "radar": {
      const inline = Array.isArray(args.series) ? args.series : []
      args.labels = textColumn(dataset, args.labels ?? 0, "labels")
      const refs: unknown[] = inline.length > 0 ? inline.map((entry) => entry.values) : [args.values ?? 1]
      args.series = refs.map((ref, i) => ({
        name: inline[i]?.name ?? (typeof ref === "string" ? ref : `Series ${i + 1}`),
        values: numericColumn(dataset, ref ?? 1, `series[${i}]`),
      }))
      break
    }
    case "sparkline": {
      args.values = numericColumn(dataset, args.values ?? 0, "values")
      break
    }
    case "progress": {
      args.value = pickValues()[0] ?? 0
      break
    }
    case "scatter": {
      const x = numericColumn(dataset, args.x ?? 0, "x")
      const y = numericColumn(dataset, args.y ?? 1, "y")
      const groups = args.group === undefined ? undefined : textColumn(dataset, args.group, "group")
      const grouped: { name: string; points: ScatterPoint[] }[] = []
      const buckets = new Map<string, { name: string; points: ScatterPoint[] }>()
      for (let i = 0; i < x.length; i++) {
        const name = groups?.[i] ?? ""
        let bucket = buckets.get(name)
        if (!bucket) {
          bucket = { name, points: [] }
          buckets.set(name, bucket)
          grouped.push(bucket)
        }
        bucket.points.push([x[i] ?? 0, y[i] ?? 0])
      }
      args.series = grouped.map((entry) => (entry.name ? { name: entry.name, points: entry.points } : { points: entry.points }))
      break
    }
    case "heatmap": {
      const rowNames: string[] = []
      const columnNames: string[] = []
      const rowValues = textColumn(dataset, args.row ?? 0, "row")
      const columnValues = textColumn(dataset, args.column ?? 1, "column")
      const values = numericColumn(dataset, args.value ?? 2, "value")
      const matrix: number[][] = []
      for (let i = 0; i < values.length; i++) {
        const rowName = rowValues[i] ?? "?"
        const columnName = columnValues[i] ?? "?"
        let r = rowNames.indexOf(rowName)
        if (r < 0) {
          r = rowNames.push(rowName) - 1
          matrix.push([])
        }
        let c = columnNames.indexOf(columnName)
        if (c < 0) c = columnNames.push(columnName) - 1
        matrix[r]![c] = values[i] ?? 0
      }
      args.matrix = matrix
      args.rowLabels = rowNames
      args.columnLabels = columnNames
      break
    }
    case "timeline": {
      const labels = pickLabels()
      const start = numericColumn(dataset, args.start ?? 1, "start")
      const end = numericColumn(dataset, args.end ?? 2, "end")
      args.spans = labels.map((label, i) => ({ label, start: start[i] ?? 0, end: end[i] ?? 0 }))
      break
    }
    case "stats":
    case "kv":
    case "checklist":
    case "badges": {
      const labels = pickLabels()
      const values = textColumn(dataset, args.value ?? 1, "value")
      args.items = labels.map((label, i) => ({ label, value: values[i] ?? "" }))
      break
    }
    case "table": {
      args.columns = dataset.columns
      args.rows = dataset.rows.slice(0, 60)
      break
    }
    default:
      fail(`element "${element}" does not accept a \`source\``)
  }
}

function requireScatterSeries(args: ShowArgs): { name?: string; points: ScatterPoint[] }[] {
  const series = Array.isArray(args.series) ? args.series : []
  const cleaned = series.map((entry) => ({
    name: entry?.name,
    points: (Array.isArray(entry?.points) ? entry.points : []).filter(
      (point): point is ScatterPoint => Array.isArray(point) && point.length >= 2,
    ),
  }))
  if (cleaned.length === 0 || cleaned.every((entry) => entry.points.length === 0)) {
    fail("scatter needs `series` with `points` ([[x, y], …]) — or a `source` with x/y columns")
  }
  return cleaned
}

function requireSpans(args: ShowArgs): { label: string; start: number; end: number }[] {
  const spans = args.spans
  if (!spans || spans.length === 0) {
    fail("timeline needs `spans` ([{label, start, end}]) — or a `source` with label/start/end columns")
  }
  return spans!
}

function renderChartSvg(element: string, args: ShowArgs): string {
  switch (element) {
    case "bar":
      return barChart(requireData(args, "bar chart"), { ...chartOptions(args), height: args.height })
    case "column":
      return columnChart(requireLabels(args), requireSeries(args), {
        ...chartOptions(args),
        stacked: args.stacked,
        percent: args.percent === true,
      })
    case "line":
      return lineChart(requireLabels(args), requireSeries(args), chartOptions(args))
    case "area":
      return lineChart(requireLabels(args), requireSeries(args), { ...chartOptions(args), area: true })
    case "donut":
      return donutChart(requireData(args, "donut chart"), chartOptions(args))
    case "sparkline":
      return sparklineChart(requireSeries(args)[0]!.values, chartOptions(args))
    case "gauge":
      if (typeof args.value !== "number") fail("gauge needs a numeric `value`")
      return gaugeChart(args.value!, {
        ...chartOptions(args),
        min: args.min,
        max: args.max,
        label: args.subtitle,
        bands: cap(args.bands, 8, "bands"),
      })
    case "scatter": {
      const series = requireScatterSeries(args)
      const total = countScatterPoints(series)
      if (total <= SVG_SCATTER_POINTS) return scatterChart(series, chartOptions(args))
      const stride = Math.ceil(total / SVG_SCATTER_POINTS)
      const sampled = series.map((entry) => ({
        ...entry,
        points: entry.points.filter((_, index) => index % stride === 0),
      }))
      const opts = chartOptions(args)
      if (opts.alpha === undefined) opts.alpha = 0.4
      return scatterChart(sampled, {
        ...opts,
        radius: 2,
        note: `${fmtCompact(countScatterPoints(sampled))} of ${fmtCompact(total)} points`,
      })
    }
    case "waterfall":
      return waterfallChart(requireData(args, "waterfall chart"), chartOptions(args))
    case "heatmap": {
      if (!args.matrix || args.matrix.length === 0) {
        fail("heatmap needs `matrix` (array of rows) — or a `source` with row/column/value columns")
      }
      return heatmapChart(args.matrix!, {
        ...chartOptions(args),
        rowLabels: args.rowLabels,
        columnLabels: args.columnLabels,
      })
    }
    case "radar":
      return radarChart(requireLabels(args), requireSeries(args), { ...chartOptions(args), max: args.max })
    case "timeline":
      return timelineChart(requireSpans(args), { ...chartOptions(args), dates: args.dates })
    case "funnel":
      return funnelChart(requireData(args, "funnel chart"), chartOptions(args))
    case "progress":
      if (typeof args.value !== "number") fail("progress needs a numeric `value`")
      return progressChart(args.value!, {
        ...chartOptions(args),
        max: args.max,
        bands: cap(args.bands, 8, "bands"),
        label: args.subtitle,
      })
    case "treemap":
      return treemapChart(requireData(args, "treemap chart"), chartOptions(args))
    default:
      fail(`unknown chart element "${element}"`)
  }
}

const SVG_SCATTER_POINTS = 20_000
const SCATTER_SOURCE_LIMITS = { maxRows: 300_000, maxBytes: 16 * 1024 * 1024 }

function countScatterPoints(series: { points: [number, number][] }[]): number {
  let count = 0
  for (const entry of series) {
    for (const [x, y] of entry.points) {
      if (Number.isFinite(x) && Number.isFinite(y)) count++
    }
  }
  return count
}

const ART_SAMPLE_POINTS = 4000

function sampleScatter<T extends { points: ScatterPoint[] }>(series: T[]): T[] {
  const total = series.reduce((sum, entry) => sum + entry.points.length, 0)
  if (total <= ART_SAMPLE_POINTS) return series
  const stride = Math.ceil(total / ART_SAMPLE_POINTS)
  return series.map((entry) => ({ ...entry, points: entry.points.filter((_, index) => index % stride === 0) }))
}

function renderChartArt(element: string, args: ShowArgs): string[] {
  switch (element) {
    case "bar":
      return barArt(requireData(args, "bar chart"), args.unit)
    case "column":
      return columnArt(requireLabels(args), requireSeries(args), { percent: args.percent === true })
    case "line":
    case "area":
    case "sparkline": {
      const series = requireSeries(args)
      if (series.length === 1) return sparklineArt(series[0]!.values)
      return series.map((entry, i) => `${entry.name ?? `Series ${i + 1}`}: ${sparklineArt(entry.values).join(" ")}`)
    }
    case "donut":
      return donutArt(requireData(args, "donut chart"))
    case "gauge":
      if (typeof args.value !== "number") fail("gauge needs a numeric `value`")
      return gaugeArt(args.value!, { min: args.min, max: args.max, label: args.subtitle, unit: args.unit })
    case "scatter": {
      const series = requireScatterSeries(args)
      return scatterArt(sampleScatter(series), { total: countScatterPoints(series) })
    }
    case "waterfall":
      return waterfallArt(requireData(args, "waterfall chart"), args.unit)
    case "heatmap": {
      if (!args.matrix || args.matrix.length === 0) {
        fail("heatmap needs `matrix` (array of rows) — or a `source` with row/column/value columns")
      }
      return heatmapArt(args.matrix!, { rowLabels: args.rowLabels, columnLabels: args.columnLabels })
    }
    case "radar":
      return radarArt(requireLabels(args), requireSeries(args))
    case "timeline":
      return timelineArt(requireSpans(args), args.dates)
    case "funnel":
      return funnelArt(requireData(args, "funnel chart"), args.unit)
    case "progress":
      if (typeof args.value !== "number") fail("progress needs a numeric `value`")
      return progressArt(args.value!, {
        min: args.min,
        max: args.max,
        label: args.subtitle,
        unit: args.unit,
        bands: cap(args.bands, 8, "bands"),
      })
    case "treemap":
      return treemapArt(requireData(args, "treemap chart"))
    default:
      fail(`unknown chart element "${element}"`)
  }
}

function renderPanel(element: string, args: ShowArgs): string {
  const items = cap(args.items, 40, "items") ?? []
  switch (element) {
    case "stats": {
      if (items.length === 0) fail("stats needs `items` with label/value")
      return statsMarkdown(
        items.map((item) => ({
          label: item.label ?? item.name ?? "?",
          value: item.value ?? "",
          unit: item.unit,
          delta: item.delta,
          trend: item.trend,
        })),
        args.title,
      )
    }
    case "kv": {
      if (items.length === 0) fail("kv needs `items` with label/value")
      return kvMarkdown(
        items.map((item) => ({ label: item.label ?? item.name ?? "?", value: item.value ?? "" })),
        args.title,
      )
    }
    case "checklist": {
      if (items.length === 0) fail("checklist needs `items` with label/status")
      return checklistMarkdown(
        items.map((item) => ({
          label: item.label ?? item.name ?? "?",
          status: item.status ?? "todo",
          detail: item.detail,
        })),
        args.title,
        typeof args.percent === "number" ? args.percent : undefined,
      )
    }
    case "badges": {
      if (items.length === 0) fail("badges needs `items` with name")
      return badgesMarkdown(
        items.map((item) => ({ name: item.name ?? item.label ?? "?", value: item.value })),
        args.title,
      )
    }
    case "table": {
      const columns = cap(args.columns, 8, "columns")
      const rows = cap(args.rows, 60, "rows")
      if (!columns || columns.length === 0) fail("table needs `columns`")
      if (!rows) fail("table needs `rows`")
      for (const row of rows!) {
        if (!Array.isArray(row) || row.length !== columns!.length) fail(`each table row needs ${columns!.length} cells`)
      }
      return tableMarkdown(columns!, rows!, args.align, args.title)
    }
    case "callout": {
      if (!args.body) fail("callout needs `body`")
      return calloutMarkdown(args.level ?? "info", args.body!, args.title)
    }
    case "quote": {
      if (!args.text) fail("quote needs `text`")
      return quoteMarkdown(args.text!, args.attribution)
    }
    default:
      fail(`unknown element "${element}"`)
  }
}

export type ShowRenderDeps = {
  surface: Surface
  charts: ChartPublisher
  baseDirs: string[]
}

export async function renderShowBlock(args: Record<string, unknown>, deps: ShowRenderDeps): Promise<string> {
  const element = typeof args.element === "string" ? args.element : ""
  if (!ELEMENTS.includes(element as (typeof ELEMENTS)[number])) {
    fail(`unknown element "${element}" — use one of ${ELEMENTS.join(", ")}`)
  }
  const showArgs = args as ShowArgs
  if (showArgs.source !== undefined) {
    const limits = element === "scatter" ? SCATTER_SOURCE_LIMITS : undefined
    const dataset = await loadDataset(showArgs.source, deps.baseDirs, limits)
    applySource(element, showArgs, dataset)
  } else {
    normalizeCompact(showArgs)
  }
  const isChart = CHART_ELEMENTS.has(element)
  if (isChart && deps.surface === "image") {
    const svg = renderChartSvg(element, showArgs)
    const url = await deps.charts.publish(newId(), svg)
    if (url) return urlPayload(showArgs.title ?? element, url)
    return artFence(renderChartArt(element, showArgs))
  }
  return isChart ? artFence(renderChartArt(element, showArgs)) : renderPanel(element, showArgs)
}
