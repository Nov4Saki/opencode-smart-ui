import { readFile, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

export type Cell = string | number

export type Dataset = {
  columns: string[]
  rows: Cell[][]
  format: "csv" | "tsv" | "json"
}

export type SourceSpec = string | { path: string; format?: "csv" | "tsv" | "json" }

export const MAX_BYTES = 2 * 1024 * 1024
export const MAX_ROWS = 2000

export type DatasetLimits = { maxRows?: number; maxBytes?: number }

function fail(message: string): never {
  throw new Error(message)
}

function coerceCell(value: unknown): Cell {
  if (typeof value === "number") return Number.isFinite(value) ? value : ""
  if (typeof value === "boolean") return String(value)
  if (value === null || value === undefined) return ""
  return coerceText(String(value))
}

function coerceText(text: string): Cell {
  const trimmed = text.trim()
  if (trimmed === "") return ""
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

export function parseDelimited(text: string, delimiter: string): Cell[][] {
  const rows: Cell[][] = []
  let row: Cell[] = []
  let field = ""
  let quoted = false
  let index = 0
  const pushField = (): void => {
    row.push(coerceText(field))
    field = ""
  }
  const pushRow = (): void => {
    pushField()
    if (row.some((cell) => String(cell).trim() !== "")) rows.push(row)
    row = []
  }
  while (index < text.length) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }
    if (char === '"' && field.trim() === "") {
      quoted = true
      field = ""
      index += 1
      continue
    }
    if (char === delimiter) {
      pushField()
      index += 1
      continue
    }
    if (char === "\n") {
      pushRow()
      index += 1
      continue
    }
    if (char === "\r") {
      index += 1
      continue
    }
    field += char
    index += 1
  }
  if (field.length > 0 || row.length > 0) pushRow()
  return rows
}

function fromMatrix(matrix: Cell[][], format: Dataset["format"], maxRows = MAX_ROWS): Dataset {
  if (matrix.length === 0) return { columns: [], rows: [], format }
  const first = matrix[0]!
  const header = first.length > 0 && first.every((cell) => cell !== "" && typeof cell !== "number")
  const columns = header
    ? first.map((cell, index) => String(cell) || `col${index + 1}`)
    : first.map((_, index) => `col${index + 1}`)
  const rows = (header ? matrix.slice(1) : matrix).slice(0, maxRows)
  return { columns, rows, format }
}

function fromJson(value: unknown, maxRows = MAX_ROWS): Dataset {
  if (Array.isArray(value)) {
    if (value.length === 0) return { columns: [], rows: [], format: "json" }
    const first = value[0]
    if (typeof first === "number" || typeof first === "string" || typeof first === "boolean") {
      return { columns: ["value"], rows: value.slice(0, maxRows).map((entry) => [coerceCell(entry)]), format: "json" }
    }
    if (Array.isArray(first)) {
      return fromMatrix(
        value.slice(0, maxRows).map((row) => (Array.isArray(row) ? row.map(coerceCell) : [])),
        "json",
      )
    }
    if (first && typeof first === "object") {
      const columns: string[] = []
      for (const entry of value) {
        if (!entry || typeof entry !== "object") continue
        for (const key of Object.keys(entry as Record<string, unknown>)) {
          if (!columns.includes(key)) columns.push(key)
        }
      }
      const rows = value.slice(0, maxRows).map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>
        return columns.map((key) => coerceCell(record[key]))
      })
      return { columns, rows, format: "json" }
    }
    fail("source JSON array has an unsupported shape")
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    if (Array.isArray(object.rows)) {
      const matrix = object.rows.map((row) => (Array.isArray(row) ? row.map(coerceCell) : []))
      const dataset = fromMatrix(matrix, "json", maxRows)
      if (Array.isArray(object.columns)) {
        const columns = object.columns.map(String)
        if (columns.length === matrix[0]?.length) return { ...dataset, columns }
      }
      return dataset
    }
    if (Array.isArray(object.data)) return fromJson(object.data, maxRows)
    if (Array.isArray(object.values)) return fromJson(object.values, maxRows)
    if (typeof object.value === "number" || typeof object.value === "string") {
      return { columns: ["value"], rows: [[coerceCell(object.value)]], format: "json" }
    }
  }
  fail("source JSON must be an array of rows/objects, a matrix, or { columns, rows }")
}

function sniffFormat(text: string): "csv" | "tsv" | "json" {
  const head = text.trimStart()
  if (head.startsWith("[") || head.startsWith("{")) return "json"
  if (head.includes("\t")) return "tsv"
  return "csv"
}

export async function loadDataset(
  spec: SourceSpec,
  baseDirs: string | string[],
  limits: DatasetLimits = {},
): Promise<Dataset> {
  const maxBytes = limits.maxBytes ?? MAX_BYTES
  const maxRows = limits.maxRows ?? MAX_ROWS
  const path = typeof spec === "string" ? spec : spec?.path
  const requested = typeof spec === "string" ? undefined : spec?.format
  if (!path || typeof path !== "string") fail("`source` must be a file path or { path, format }")
  if (requested && !["csv", "tsv", "json"].includes(requested)) {
    fail(`source format must be csv, tsv or json (got "${requested}")`)
  }
  const roots = (Array.isArray(baseDirs) ? baseDirs : [baseDirs]).filter((root) => root && root.length > 0)
  const candidates = isAbsolute(path) ? [path] : roots.map((root) => resolve(root, path))
  let full: string | undefined
  let size = 0
  const attempts = 4
  for (let attempt = 0; attempt < attempts && !full; attempt++) {
    for (const candidate of candidates) {
      try {
        const info = await stat(candidate)
        if (!info.isFile()) continue
        full = candidate
        size = info.size
        break
      } catch {}
    }
    if (!full && attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!full) {
    const tried = candidates.length > 0 ? candidates.map((candidate) => `"${candidate}"`).join(", ") : "(no project root)"
    fail(`cannot read source "${path}" — tried ${tried}`)
  }
  if (size > maxBytes) {
    fail(`source is too large (${Math.round(size / 1024 / 1024)} MB, max ${Math.round(maxBytes / 1024 / 1024)} MB): ${path}`)
  }
  const text = await readFile(full, "utf8")
  const ext = path.toLowerCase().slice(path.lastIndexOf(".") + 1)
  const format: Dataset["format"] =
    requested ??
    (ext === "tsv" || ext === "tab" ? "tsv" : ext === "json" ? "json" : ext === "csv" ? "csv" : sniffFormat(text))
  if (format === "json") {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      fail(`source JSON is invalid — ${(error as Error).message}`)
    }
    return fromJson(parsed, maxRows)
  }
  return fromMatrix(parseDelimited(text, format === "tsv" ? "\t" : ","), format, maxRows)
}

function columnIndex(dataset: Dataset, ref: unknown): number | undefined {
  if (typeof ref === "number" && Number.isInteger(ref) && ref >= 0 && ref < dataset.columns.length) return ref
  if (typeof ref === "string") {
    const named = dataset.columns.indexOf(ref)
    if (named >= 0) return named
    const asIndex = Number(ref)
    if (Number.isInteger(asIndex) && asIndex >= 0 && asIndex < dataset.columns.length) return asIndex
  }
  return undefined
}

export function pickColumn(dataset: Dataset, ref: unknown, what: string): Cell[] {
  const index = columnIndex(dataset, ref)
  if (index === undefined) {
    const columns = dataset.columns.length > 0 ? dataset.columns.join(", ") : "(no columns)"
    fail(`source ${what} must name a column — got ${JSON.stringify(ref ?? null)}, available: ${columns}`)
  }
  return dataset.rows.map((row) => row[index!] ?? "")
}

export function numericColumn(dataset: Dataset, ref: unknown, what: string): number[] {
  const values = pickColumn(dataset, ref, what).map((cell) => (typeof cell === "number" ? cell : Number(cell)))
  if (values.some((value) => !Number.isFinite(value))) {
    fail(`source column ${JSON.stringify(String(ref))} (${what}) has non-numeric values`)
  }
  return values
}

export function textColumn(dataset: Dataset, ref: unknown, what: string): string[] {
  return pickColumn(dataset, ref, what).map((cell) => String(cell))
}
