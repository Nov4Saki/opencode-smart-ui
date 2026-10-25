import { bar, clamp, displayWidth, formatNumber, formatPct, frame, joinColumns, padCenter, padLeft, padRight, truncate, wrapText } from "./util.ts"

export type StatItem = {
  label: string
  value: string | number
  unit?: string
  delta?: string
  trend?: "up" | "down" | "flat"
  hint?: string
}

export type StatsInput = {
  title?: string
  items: StatItem[]
}

export type ChecklistStatus = "todo" | "doing" | "done" | "blocked" | "skipped"

export type ChecklistItem = {
  label: string
  status: ChecklistStatus
  detail?: string
}

export type ChecklistInput = {
  title?: string
  items: ChecklistItem[]
  percent?: number
}

export type CalloutLevel = "info" | "success" | "warning" | "error" | "tip"

export type CalloutInput = {
  level: CalloutLevel
  title?: string
  body: string
}

export type TreeNode = {
  label: string
  note?: string
  children?: TreeNode[]
}

export type TreeInput = {
  title?: string
  nodes: TreeNode[]
}

export type SuggestItem = {
  label: string
  prompt: string
  description?: string
}

export type SuggestInput = {
  title?: string
  items: SuggestItem[]
}

export type TableInput = {
  title?: string
  columns: string[]
  rows: (string | number)[][]
  align?: ("l" | "c" | "r")[]
  maxColWidth?: number
}

export type DividerInput = {
  label?: string
}

const TREND_ARROWS: Record<string, string> = { up: "↑", down: "↓", flat: "→" }
const STATUS_GLYPHS: Record<ChecklistStatus, string> = { done: "✔", doing: "▸", todo: "○", blocked: "✖", skipped: "⊘" }
const CALLOUT_ICONS: Record<CalloutLevel, string> = { info: "ℹ", success: "✔", warning: "⚠", error: "✖", tip: "✦" }
const STATUS_WEIGHT: Record<ChecklistStatus, number> = { done: 1, doing: 0.5, todo: 0, blocked: 0, skipped: 0 }

function statValue(item: StatItem): string {
  const raw = typeof item.value === "number" ? formatNumber(item.value) : item.value
  return raw + (item.unit ?? "")
}

function cardContentRows(item: StatItem): string[] {
  const rows = [truncate(item.label, 24), truncate(statValue(item), 24)]
  if (item.delta || item.trend) {
    const arrow = item.trend ? (TREND_ARROWS[item.trend] ?? "") + " " : ""
    rows.push(truncate((arrow + (item.delta ?? "")).trim(), 24))
  }
  if (item.hint) rows.push(truncate(item.hint, 24))
  return rows
}

function statCard(item: StatItem, innerWidth: number): string[] {
  const rows = cardContentRows(item)
  const top = "┌" + "─".repeat(innerWidth + 2) + "┐"
  const bottom = "└" + "─".repeat(innerWidth + 2) + "┘"
  const body = rows.map((row) => "│ " + padRight(row, innerWidth) + " │")
  return [top, ...body, bottom]
}

export function renderStats(input: StatsInput, maxWidth: number): string[] {
  if (input.items.length === 0) throw new Error("stats needs at least one item")
  const cards = input.items.slice(0, 8).map((item) => {
    const innerWidth = Math.max(9, ...cardContentRows(item).map((row) => displayWidth(row)))
    return { lines: statCard(item, innerWidth), width: innerWidth + 4 }
  })
  const lines: string[] = []
  if (input.title) lines.push(truncate(input.title, maxWidth))
  let row: string[][] = []
  let rowWidth = 0
  const flush = () => {
    if (row.length === 0) return
    lines.push(...joinColumns(row))
    row = []
    rowWidth = 0
  }
  for (const card of cards) {
    const extra = row.length === 0 ? card.width : card.width + 1
    if (rowWidth + extra > maxWidth && row.length > 0) flush()
    row.push(card.lines)
    rowWidth += extra
  }
  flush()
  return lines
}

export function renderChecklist(input: ChecklistInput, maxWidth: number): string[] {
  if (input.items.length === 0) throw new Error("checklist needs at least one item")
  const lines: string[] = []
  if (input.title) lines.push(truncate(input.title, maxWidth))
  for (const item of input.items) {
    const glyph = STATUS_GLYPHS[item.status] ?? "○"
    const detail = item.detail ? " — " + item.detail : ""
    lines.push(truncate(`${glyph} ${item.label}${detail}`, maxWidth))
  }
  const computed = input.items.reduce((sum, item) => sum + (STATUS_WEIGHT[item.status] ?? 0), 0) / input.items.length
  const percent = clamp(input.percent ?? computed, 0, 1)
  const barWidth = clamp(Math.floor(maxWidth / 3), 10, 28)
  lines.push(`[${bar(percent, barWidth)}] ${formatPct(percent, 0)} complete`)
  return lines
}

export function renderCallout(input: CalloutInput, maxWidth: number): string[] {
  const body = wrapText(input.body, Math.max(10, maxWidth - 6))
  const icon = CALLOUT_ICONS[input.level] ?? "•"
  const label = input.title ?? input.level
  return frame({ lines: body, width: maxWidth, title: label, icon })
}

export function renderTable(input: TableInput, maxWidth: number): string[] {
  if (input.columns.length === 0) throw new Error("table needs columns")
  if (input.rows.length === 0) throw new Error("table needs at least one row")
  const limit = 36
  const visibleRows = input.rows.slice(0, limit)
  const formatCell = (cell: string | number): string => (typeof cell === "number" ? formatNumber(cell) : String(cell))
  const cap = clamp(input.maxColWidth ?? 30, 3, 60)
  const widths = input.columns.map((header, index) => {
    const cells = visibleRows.map((row) => displayWidth(formatCell(row[index] ?? "")))
    return clamp(Math.max(displayWidth(header), ...cells), 3, cap)
  })
  const borders = input.columns.length + 1
  let total = widths.reduce((sum, width) => sum + width, 0) + borders + 2 * input.columns.length
  while (total > maxWidth) {
    const widest = widths.indexOf(Math.max(...widths))
    if ((widths[widest] ?? 3) <= 3) break
    widths[widest] = (widths[widest] ?? 3) - 1
    total -= 1
  }
  const line = (left: string, mid: string, right: string) => left + widths.map((width) => "─".repeat(width + 2)).join(mid) + right
  const rowLine = (cells: (string | number)[], isHeader: boolean) =>
    "│" +
    input.columns
      .map((header, index) => {
        const text = truncate(isHeader ? header : formatCell(cells[index] ?? ""), widths[index] ?? 3)
        const align = input.align?.[index] ?? (isHeader ? "l" : typeof cells[index] === "number" ? "r" : "l")
        const padded = align === "r" ? padLeft(text, widths[index] ?? 3) : align === "c" ? padCenter(text, widths[index] ?? 3) : padRight(text, widths[index] ?? 3)
        return " " + padded + " "
      })
      .join("│") +
    "│"
  const lines: string[] = []
  if (input.title) lines.push(truncate(input.title, maxWidth))
  lines.push(line("┌", "┬", "┐"))
  lines.push(rowLine(input.columns, true))
  lines.push(line("├", "┼", "┤"))
  for (const row of visibleRows) lines.push(rowLine(row, false))
  lines.push(line("└", "┴", "┘"))
  if (input.rows.length > limit) lines.push(`… ${input.rows.length - limit} more rows`)
  return lines
}

type TreeEntry = {
  text: string
  note?: string
}

function walkTree(nodes: TreeNode[], prefix: string, entries: TreeEntry[]): void {
  nodes.forEach((node, index) => {
    const last = index === nodes.length - 1
    entries.push({ text: prefix + (last ? "└─ " : "├─ ") + node.label, note: node.note })
    if (node.children && node.children.length > 0) {
      walkTree(node.children, prefix + (last ? "   " : "│  "), entries)
    }
  })
}

export function renderTree(input: TreeInput, maxWidth: number): string[] {
  if (input.nodes.length === 0) throw new Error("tree needs nodes")
  const entries: TreeEntry[] = []
  if (input.nodes.length === 1 && input.nodes[0]!.children && input.nodes[0]!.children.length > 0) {
    const root = input.nodes[0]!
    entries.push({ text: root.label, note: root.note })
    walkTree(root.children!, "", entries)
  } else {
    walkTree(input.nodes, "", entries)
  }
  const textWidth = Math.max(0, ...entries.map((entry) => displayWidth(entry.text)))
  const noteWidth = Math.max(0, ...entries.map((entry) => displayWidth(entry.note ?? "")))
  const aligned = textWidth + 2 + noteWidth <= maxWidth && noteWidth > 0
  const lines: string[] = []
  if (input.title) lines.push(truncate(input.title, maxWidth))
  for (const entry of entries) {
    if (!entry.note) {
      lines.push(truncate(entry.text, maxWidth))
      continue
    }
    if (aligned) {
      lines.push(truncate(padRight(entry.text, textWidth) + "  " + entry.note, maxWidth))
    } else {
      lines.push(truncate(entry.text + " (" + entry.note + ")", maxWidth))
    }
  }
  return lines
}

export function renderSuggest(input: SuggestInput, maxWidth: number, prefilledIndex?: number): string[] {
  if (input.items.length === 0) throw new Error("suggest needs at least one item")
  const lines: string[] = [truncate("✦ " + (input.title ?? "Suggested next steps"), maxWidth)]
  input.items.forEach((item, index) => {
    const number = index + 1
    const description = item.description ? " — " + item.description : ""
    lines.push(truncate(`  ${number}. ▸ ${item.label}${description}`, maxWidth))
    for (const promptLine of wrapText(`"${item.prompt}"`, Math.max(8, maxWidth - 6))) {
      lines.push("     " + promptLine)
    }
    if (prefilledIndex === number) {
      lines.push("     ↳ prefilled in your input box — press Enter to run it")
    }
  })
  return lines
}

export function renderDivider(input: DividerInput, maxWidth: number): string[] {
  if (input.label) {
    const label = " " + input.label + " "
    const remaining = Math.max(0, maxWidth - displayWidth(label))
    const left = Math.floor(remaining / 2)
    return ["─".repeat(left) + label + "─".repeat(remaining - left)]
  }
  return ["─".repeat(maxWidth)]
}
