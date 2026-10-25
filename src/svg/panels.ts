function cell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()
}

function heading(title?: string): string[] {
  return title ? [`**${title}**`, ""] : []
}

export function statsMarkdown(
  items: { label: string; value: string | number; unit?: string; delta?: string; trend?: "up" | "down" | "flat" }[],
  title?: string,
): string {
  const hasChange = items.some((item) => item.delta || item.trend)
  const arrow = (trend?: "up" | "down" | "flat"): string =>
    trend === "up" ? "▲" : trend === "down" ? "▼" : trend === "flat" ? "—" : ""
  const lines = [...heading(title), hasChange ? "| Metric | Value | Change |" : "| Metric | Value |", "|---|---|---|"]
  for (const item of items) {
    const value = `${item.value}${item.unit ? ` ${item.unit}` : ""}`
    if (hasChange) {
      const change = [item.delta, arrow(item.trend)].filter(Boolean).join(" ")
      lines.push(`| ${cell(item.label)} | ${cell(value)} | ${cell(change)} |`)
    } else {
      lines.push(`| ${cell(item.label)} | ${cell(value)} |`)
    }
  }
  return lines.join("\n")
}

export function kvMarkdown(items: { label: string; value: string | number }[], title?: string): string {
  const lines = [...heading(title), "| | |", "|---|---|"]
  for (const item of items) lines.push(`| **${cell(item.label)}** | ${cell(item.value)} |`)
  return lines.join("\n")
}

export function tableMarkdown(
  columns: string[],
  rows: (string | number)[][],
  align: ("l" | "c" | "r")[] = [],
  title?: string,
): string {
  const rule = (i: number): string => {
    const a = align[i]
    if (a === "c") return ":---:"
    if (a === "r") return "---:"
    return "---"
  }
  const lines = [
    ...heading(title),
    `| ${columns.map(cell).join(" | ")} |`,
    `| ${columns.map((_, i) => rule(i)).join(" | ")} |`,
  ]
  for (const row of rows) lines.push(`| ${row.map(cell).join(" | ")} |`)
  return lines.join("\n")
}

const STATUS_SUFFIX: Record<string, string> = {
  doing: "in progress",
  blocked: "blocked",
  skipped: "skipped",
}

export function checklistMarkdown(
  items: { label: string; status: "todo" | "doing" | "done" | "blocked" | "skipped"; detail?: string }[],
  title?: string,
  percent?: number,
): string {
  const lines = heading(title)
  if (typeof percent === "number") lines.push(`**Progress: ${Math.round(percent)}%**`, "")
  for (const item of items) {
    const suffix = STATUS_SUFFIX[item.status]
    const parts = [item.detail, suffix ? `(${suffix})` : undefined].filter(Boolean).join(" ")
    lines.push(`- ${item.status === "done" || item.status === "skipped" ? "[x]" : "[ ]"} **${item.label}**${parts ? ` — ${parts}` : ""}`)
  }
  return lines.join("\n")
}

const CALLOUT_LABEL: Record<string, string> = {
  info: "Note",
  success: "Done",
  warning: "Warning",
  error: "Error",
  tip: "Tip",
}

export function calloutMarkdown(level: string, body: string, title?: string): string {
  const label = title ?? CALLOUT_LABEL[level] ?? "Note"
  const lines = body.split(/\r?\n/)
  const [first, ...rest] = lines
  const out = [`> **${label}** — ${first ?? ""}`]
  for (const line of rest) out.push(`> ${line}`)
  return out.join("\n")
}

export function badgesMarkdown(items: { name: string; value?: string | number }[], title?: string): string {
  const chips = items.map((item) => `\`${item.name}${item.value === undefined ? "" : `: ${item.value}`}\``)
  return [...heading(title), chips.join(" · ")].join("\n")
}

export function quoteMarkdown(text: string, attribution?: string): string {
  const lines = text.split(/\r?\n/).map((line) => `> ${line}`)
  if (attribution) {
    lines.push(">", `> — ${attribution}`)
  }
  return lines.join("\n")
}
