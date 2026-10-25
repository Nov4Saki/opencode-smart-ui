import { clamp, clusterWidth, displayWidth, formatNumber, graphemes, padLeft, padRight, truncate, wrapText } from "./util.ts"

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const META_PREFIXES = [
  "rename from ",
  "rename to ",
  "copy from ",
  "copy to ",
  "similarity index ",
  "dissimilarity index ",
  "new file mode ",
  "deleted file mode ",
  "old mode ",
  "new mode ",
  "index ",
  "Binary files ",
]
const MAX_DIFF_LINES = 34

export type DiffLine = { type: "ctx" | "add" | "del" | "marker"; text: string }
export type DiffHunk = { header: string; lines: DiffLine[] }
export type DiffSection = { path?: string; meta: string[]; hunks: DiffHunk[] }

export type DiffInput = {
  title?: string
  path?: string
  patch?: string
  hunks?: DiffHunk[]
  showWhitespace?: boolean
}

function hunkStart(header: string): { old: number; next: number } {
  const match = HUNK_HEADER.exec(header)
  if (!match) {
    throw new Error(`hunk header must look like "@@ -12,4 +12,6 @@": ${JSON.stringify(truncate(header, 48))}`)
  }
  return { old: Number(match[1]), next: Number(match[3]) }
}

export function parsePatch(patch: string): DiffSection[] {
  const sections: DiffSection[] = []
  let current: DiffSection | undefined
  let hunk: DiffHunk | undefined
  const lines = patch.split(/\r?\n/)
  lines.forEach((raw, index) => {
    const lineNo = index + 1
    if (raw.startsWith("diff --git ")) {
      const match = / b\/(.+)$/.exec(raw)
      current = { path: match?.[1], meta: [], hunks: [] }
      sections.push(current)
      hunk = undefined
      return
    }
    if (raw.startsWith("--- ")) return
    if (raw.startsWith("+++ ")) {
      if (!current) {
        current = { meta: [], hunks: [] }
        sections.push(current)
      }
      const path = raw.slice(4).trim()
      if (path !== "/dev/null") current.path = path.replace(/^[ab]\//, "")
      return
    }
    if (raw.startsWith("@@")) {
      if (!current) {
        current = { meta: [], hunks: [] }
        sections.push(current)
      }
      if (!HUNK_HEADER.test(raw)) {
        throw new Error(`patch line ${lineNo} is not a valid hunk header: ${JSON.stringify(truncate(raw, 48))}`)
      }
      hunk = { header: raw, lines: [] }
      current.hunks.push(hunk)
      return
    }
    if (hunk) {
      if (raw.startsWith("+")) hunk.lines.push({ type: "add", text: raw.slice(1) })
      else if (raw.startsWith("-")) hunk.lines.push({ type: "del", text: raw.slice(1) })
      else if (raw.startsWith("\\")) hunk.lines.push({ type: "marker", text: "no newline at end of file" })
      else if (raw === "") hunk = undefined
      else hunk.lines.push({ type: "ctx", text: raw.slice(1) })
      return
    }
    if (current && META_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
      current.meta.push(raw)
    }
  })
  const kept = sections.filter((section) => section.path !== undefined || section.meta.length > 0 || section.hunks.length > 0)
  if (kept.length === 0) {
    throw new Error("patch does not look like a unified diff (expected `diff --git`, `+++`, or `@@` headers)")
  }
  return kept
}

function splitByWidth(text: string, width: number): string[] {
  const out: string[] = []
  let current = ""
  let used = 0
  for (const cluster of graphemes(text)) {
    const w = clusterWidth(cluster)
    if (used + w > width && current !== "") {
      out.push(current)
      current = ""
      used = 0
    }
    current += cluster
    used += w
  }
  out.push(current)
  return out
}

export function renderDiff(input: DiffInput, maxWidth: number): string[] {
  if (input.patch !== undefined && input.hunks !== undefined) {
    throw new Error("diff takes either `patch` (unified diff text) or `hunks`, not both")
  }
  let sections: DiffSection[]
  if (input.patch !== undefined) {
    sections = parsePatch(input.patch)
  } else if (input.hunks !== undefined) {
    if (input.hunks.length === 0) throw new Error("diff needs at least one hunk")
    sections = [{ path: input.path, meta: [], hunks: input.hunks }]
  } else {
    throw new Error("diff needs `patch` (unified diff text) or `hunks`")
  }
  let maxNumber = 1
  for (const section of sections) {
    for (const hunk of section.hunks) {
      const start = hunkStart(hunk.header)
      maxNumber = Math.max(maxNumber, start.old + hunk.lines.length, start.next + hunk.lines.length)
    }
  }
  const numberWidth = Math.max(2, String(maxNumber).length)
  const textWidth = Math.max(12, maxWidth - numberWidth * 2 - 4)
  const continuation = " ".repeat(numberWidth * 2 + 2) + "↩ "
  const body: string[] = []
  for (const section of sections) {
    if (section.path !== undefined) {
      const path = truncate(section.path, Math.max(4, maxWidth - 5))
      body.push("── " + path + " " + "─".repeat(Math.max(0, maxWidth - displayWidth(path) - 4)))
    }
    for (const meta of section.meta) body.push(truncate(meta, maxWidth))
    for (const hunk of section.hunks) {
      body.push(truncate(hunk.header, maxWidth))
      const start = hunkStart(hunk.header)
      let oldNo = start.old
      let newNo = start.next
      for (const line of hunk.lines) {
        if (line.type === "marker") {
          body.push(padLeft("", numberWidth) + " " + padLeft("", numberWidth) + "   ⊘ " + line.text)
          continue
        }
        const oldCell = line.type !== "add" ? String(oldNo++) : ""
        const newCell = line.type !== "del" ? String(newNo++) : ""
        const sign = line.type === "add" ? "+" : line.type === "del" ? "-" : " "
        const text = input.showWhitespace ? line.text.replace(/ /g, "·") : line.text
        splitByWidth(text, textWidth).forEach((chunk, index) => {
          if (index === 0) {
            body.push(padLeft(oldCell, numberWidth) + " " + padLeft(newCell, numberWidth) + " " + sign + " " + chunk)
          } else {
            body.push(continuation + chunk)
          }
        })
      }
    }
  }
  const lines: string[] = []
  if (input.title) lines.push(truncate(input.title, maxWidth))
  if (body.length > MAX_DIFF_LINES) {
    lines.push(...body.slice(0, MAX_DIFF_LINES), `… +${body.length - MAX_DIFF_LINES} more diff lines`)
  } else {
    lines.push(...body)
  }
  return lines
}

export type KvItem = { label: string; value: string | number }
export type KvInput = { title?: string; items: KvItem[] }

export function renderKv(input: KvInput, maxWidth: number): string[] {
  if (input.items.length === 0) throw new Error("kv needs at least one item")
  const notes: string[] = []
  const shown = input.items.slice(0, 40)
  if (input.items.length > 40) notes.push(`… +${input.items.length - 40} more items`)
  const entries = shown.map((item) => ({
    label: truncate(item.label, 24),
    value: typeof item.value === "number" ? formatNumber(item.value) : item.value,
  }))
  const labelWidth = Math.max(3, ...entries.map((entry) => displayWidth(entry.label)))
  const valueWidth = clamp(Math.max(1, ...entries.map((entry) => displayWidth(entry.value))), 1, Math.max(1, maxWidth - labelWidth - 4))
  const lines: string[] = []
  if (input.title) lines.push(truncate(input.title, maxWidth))
  for (const entry of entries) {
    if (valueWidth >= 30 || displayWidth(entry.value) > valueWidth) {
      lines.push(truncate(padRight(entry.label, labelWidth) + "  " + entry.value, maxWidth))
      continue
    }
    const gap = maxWidth - labelWidth - displayWidth(entry.value) - 2
    if (gap >= 2) {
      lines.push(padRight(entry.label, labelWidth) + " " + ".".repeat(gap) + " " + entry.value)
    } else {
      lines.push(truncate(padRight(entry.label, labelWidth) + "  " + entry.value, maxWidth))
    }
  }
  lines.push(...notes)
  return lines
}

export type BadgeTone = "info" | "ok" | "warn" | "bad"
export type BadgeItem = { name: string; value?: string | number; tone?: BadgeTone }
export type BadgeInput = { title?: string; items: BadgeItem[] }

const TONE_GLYPHS: Record<BadgeTone, string> = { info: "ℹ", ok: "✔", warn: "⚠", bad: "✖" }

function chipLines(chips: string[], maxWidth: number): string[] {
  const lines: string[] = []
  let current = ""
  for (const chip of chips) {
    const candidate = current === "" ? chip : current + "  " + chip
    if (displayWidth(candidate) <= maxWidth || current === "") {
      current = candidate
      continue
    }
    lines.push(current)
    current = chip
  }
  if (current !== "") lines.push(current)
  if (lines.length > 2) {
    lines.length = 2
    lines[1] = truncate(lines[1]! + " …", maxWidth)
  }
  return lines
}

export function renderBadge(input: BadgeInput, maxWidth: number): string[] {
  if (input.items.length === 0) throw new Error("badge needs at least one item")
  const notes: string[] = []
  const shown = input.items.slice(0, 20)
  if (input.items.length > 20) notes.push(`… +${input.items.length - 20} more badges`)
  const chips = shown.map((item) => {
    const glyph = item.tone ? (TONE_GLYPHS[item.tone] ?? "▸") : "▸"
    const value = item.value === undefined ? "" : "·" + (typeof item.value === "number" ? formatNumber(item.value) : item.value)
    return `${glyph} ${item.name}${value}`
  })
  const lines: string[] = []
  if (input.title) lines.push(truncate(input.title, maxWidth))
  lines.push(...chipLines(chips, maxWidth))
  lines.push(...notes)
  return lines
}

export type StepStatus = "done" | "active" | "todo" | "error"
export type StepItem = { label: string; status?: StepStatus }
export type StepperInput = { title?: string; steps: StepItem[] }

const STEP_GLYPHS: Record<StepStatus, string> = { done: "✔", active: "●", todo: "○", error: "✖" }
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫"

export function renderStepper(input: StepperInput, maxWidth: number): string[] {
  if (input.steps.length === 0) throw new Error("stepper needs at least one step")
  const notes: string[] = []
  const shown = input.steps.slice(0, 12)
  if (input.steps.length > 12) notes.push(`… +${input.steps.length - 12} more steps`)
  const numbered = shown.every((step) => step.status === undefined)
  const glyphFor = (step: StepItem, index: number): string =>
    numbered ? (CIRCLED[index] ?? `(${index + 1})`) : STEP_GLYPHS[step.status ?? "todo"] ?? "○"
  const lines: string[] = []
  if (input.title) lines.push(truncate(input.title, maxWidth))
  const inline = shown.map((step, index) => `${glyphFor(step, index)} ${truncate(step.label, 18)}`).join(" ─ ")
  if (displayWidth(inline) <= maxWidth) {
    lines.push(inline)
  } else {
    for (let index = 0; index < shown.length; index++) {
      const step = shown[index]!
      lines.push(truncate(`${glyphFor(step, index)} ${step.label}`, maxWidth))
    }
  }
  lines.push(...notes)
  return lines
}

export type EmptyInput = { message: string; hint?: string }

export function renderEmpty(input: EmptyInput, maxWidth: number): string[] {
  const hint = input.hint ? " — " + input.hint : ""
  return [truncate(`∅ ${input.message}${hint}`, maxWidth)]
}

export type QuoteInput = { text: string; attribution?: string }

export function renderQuote(input: QuoteInput, maxWidth: number): string[] {
  const lines = wrapText(input.text, Math.max(8, maxWidth - 2)).map((line) => truncate("│ " + line, maxWidth))
  if (input.attribution) lines.push(truncate("│ — " + input.attribution, maxWidth))
  return lines
}

export type FootnotesInput = { title?: string; items: string[] }

const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹"

export function superscript(n: number): string {
  return String(n)
    .split("")
    .map((digit) => SUPERSCRIPTS[Number(digit)] ?? digit)
    .join("")
}

export function renderFootnotes(input: FootnotesInput, maxWidth: number): string[] {
  if (input.items.length === 0) throw new Error("footnotes needs at least one item")
  const notes: string[] = []
  const shown = input.items.slice(0, 20)
  if (input.items.length > 20) notes.push(`… +${input.items.length - 20} more footnotes`)
  const lines: string[] = []
  if (input.title) lines.push(truncate(input.title, maxWidth))
  shown.forEach((text, index) => {
    const marker = superscript(index + 1)
    const indent = " ".repeat(displayWidth(marker) + 1)
    const body = wrapText(text, Math.max(8, maxWidth - displayWidth(marker) - 1))
    body.forEach((line, lineIndex) => {
      lines.push(truncate(lineIndex === 0 ? `${marker} ${line}` : indent + line, maxWidth))
    })
  })
  lines.push(...notes)
  return lines
}
