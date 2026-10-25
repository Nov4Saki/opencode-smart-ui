const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2764, 0x2764],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
]

const ZERO_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
]

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true
  }
  return false
}

export function charWidth(cp: number): number {
  if (cp === 0) return 0
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (inRanges(cp, ZERO_RANGES)) return 0
  if (inRanges(cp, WIDE_RANGES)) return 2
  return 1
}

type GraphemeSegmenter = { segment(input: string): Iterable<{ segment: string }> }

const SEGMENTER: GraphemeSegmenter | undefined = (() => {
  try {
    const Ctor = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: string }) => GraphemeSegmenter }).Segmenter
    return Ctor ? new Ctor("en", { granularity: "grapheme" }) : undefined
  } catch {
    return undefined
  }
})()

export function graphemes(s: string): string[] {
  if (!SEGMENTER) return [...s]
  const out: string[] = []
  for (const part of SEGMENTER.segment(s)) out.push(part.segment)
  return out
}

export function clusterWidth(cluster: string): number {
  const points = [...cluster]
  if (points.length === 1) return charWidth(points[0]!.codePointAt(0) ?? 0)
  for (const ch of points) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x1f000 || cp === 0xfe0f) return 2
  }
  let width = 0
  for (const ch of points) width += charWidth(ch.codePointAt(0) ?? 0)
  return width
}

export function displayWidth(s: string): number {
  let ascii = true
  for (let index = 0; index < s.length; index++) {
    const code = s.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) {
      ascii = false
      break
    }
  }
  if (ascii) return s.length
  let width = 0
  for (const cluster of graphemes(s)) width += clusterWidth(cluster)
  return width
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function padRight(s: string, width: number): string {
  const pad = width - displayWidth(s)
  return pad > 0 ? s + " ".repeat(pad) : s
}

export function padLeft(s: string, width: number): string {
  const pad = width - displayWidth(s)
  return pad > 0 ? " ".repeat(pad) + s : s
}

export function padCenter(s: string, width: number): string {
  const total = width - displayWidth(s)
  if (total <= 0) return s
  const left = Math.floor(total / 2)
  return " ".repeat(left) + s + " ".repeat(total - left)
}

export function truncate(s: string, width: number): string {
  if (width <= 0) return ""
  if (displayWidth(s) <= width) return s
  if (width === 1) return "…"
  let out = ""
  let used = 0
  for (const cluster of graphemes(s)) {
    const w = clusterWidth(cluster)
    if (used + w > width - 1) break
    out += cluster
    used += w
  }
  return out + "…"
}

export function wrapText(text: string, width: number): string[] {
  const out: string[] = []
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd()
    if (displayWidth(line) <= width) {
      out.push(line)
      continue
    }
    let current = ""
    for (const word of line.split(/\s+/)) {
      if (!word) continue
      let w = word
      while (displayWidth(w) > width) {
        let head = ""
        let used = 0
        for (const cluster of graphemes(w)) {
          const cw = clusterWidth(cluster)
          if (used > 0 && used + cw > width) break
          head += cluster
          used += cw
          if (used >= width) break
        }
        if (current) {
          out.push(current)
          current = ""
        }
        out.push(head)
        w = w.slice(head.length)
      }
      if (!current) {
        current = w
      } else if (displayWidth(current) + 1 + displayWidth(w) <= width) {
        current += " " + w
      } else {
        out.push(current)
        current = w
      }
    }
    out.push(current)
  }
  return out
}

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]

export function bar(fraction: number, width: number, fill = "█", empty = " "): string {
  const f = Number.isFinite(fraction) ? clamp(fraction, 0, 1) : 0
  const cells = f * width
  const full = Math.floor(cells)
  const rest = cells - full
  let tail = ""
  let used = full
  if (full < width && rest > 0) {
    const idx = clamp(Math.round(rest * 8), 1, 7)
    tail = EIGHTHS[idx] ?? ""
    used += 1
  }
  return fill.repeat(full) + tail + empty.repeat(Math.max(0, width - used))
}

function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function trimDecimal(x: number, digits: number): string {
  const rounded = Math.round(x * 10 ** digits) / 10 ** digits
  const text = rounded.toFixed(digits)
  return text.replace(/\.?0+$/, "")
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const sign = n < 0 ? "-" : ""
  const abs = Math.abs(n)
  if (abs >= 1e9) return sign + trimDecimal(abs / 1e9, 1) + "B"
  if (abs >= 1e6) return sign + trimDecimal(abs / 1e6, 1) + "M"
  if (abs >= 1e5) return sign + trimDecimal(abs / 1e3, 1) + "k"
  if (Number.isInteger(abs)) {
    const [int, dec] = abs.toString().split(".")
    return sign + groupDigits(int ?? "0") + (dec ? "." + dec : "")
  }
  if (abs >= 1000) return sign + groupDigits(trimDecimal(abs, 1))
  return sign + trimDecimal(abs, 2)
}

export function formatPct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "n/a"
  const pct = fraction * 100
  const text = pct.toFixed(digits)
  return text.replace(/\.0+$/, "") + "%"
}

export function limitHeight(lines: string[], max = 42, note = "… +N more lines"): string[] {
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max - 1)
  kept.push(note.replace("N", String(lines.length - (max - 1))))
  return kept
}

export function joinColumns(blocks: string[][], gap = 1): string[] {
  const height = Math.max(0, ...blocks.map((b) => b.length))
  const widths = blocks.map((b) => Math.max(0, ...b.map((line) => displayWidth(line))))
  const lines: string[] = []
  for (let row = 0; row < height; row++) {
    const parts = blocks.map((block, i) => padRight(block[row] ?? "", widths[i] ?? 0))
    lines.push(parts.join(" ".repeat(gap)).replace(/\s+$/, ""))
  }
  return lines
}

export type FrameOptions = {
  lines: string[]
  width: number
  title?: string
  icon?: string
}

export function frame(options: FrameOptions): string[] {
  const width = Math.max(8, options.width)
  const headParts: string[] = []
  if (options.icon) headParts.push(options.icon)
  if (options.title) headParts.push(options.title)
  const head = headParts.length ? " " + headParts.join(" ") + " " : ""
  const headText = truncate(head, Math.max(0, width - 5))
  const headWidth = displayWidth(headText)
  const dashes = Math.max(1, width - 3 - headWidth)
  const top = "╭─" + headText + "─".repeat(dashes) + "╮"
  const inner = width - 4
  const body = options.lines.map((line) => "│ " + padRight(truncate(line, inner), inner) + " │")
  const bottom = "╰" + "─".repeat(Math.max(1, width - 2)) + "╯"
  return [top, ...body, bottom]
}
