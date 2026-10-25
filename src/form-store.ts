import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getForm, putForm, type FormRecord } from "./state.ts"

export const FORM_TTL_MS = 6 * 60 * 60 * 1000
export const MAX_FORM_RECORDS = 256

const KEY_RE = /^[a-z0-9]{4,32}$/

export type FormStoreOptions = { dir: string; ttlMs?: number; maxEntries?: number }

export function createFormStore(options: FormStoreOptions) {
  const dir = options.dir
  const formsDir = join(dir, "forms")
  const ttlMs = options.ttlMs ?? FORM_TTL_MS
  const maxEntries = options.maxEntries ?? MAX_FORM_RECORDS

  function list(): { file: string; mtime: number }[] {
    let names: string[]
    try {
      names = readdirSync(formsDir)
    } catch {
      return []
    }
    const entries: { file: string; mtime: number }[] = []
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      const file = join(formsDir, name)
      try {
        entries.push({ file, mtime: statSync(file).mtimeMs })
      } catch {}
    }
    return entries
  }

  function remove(file: string): void {
    try {
      rmSync(file, { force: true })
    } catch {}
  }

  function prune(now = Date.now()): void {
    const entries = list()
    const survivors: typeof entries = []
    for (const entry of entries) {
      if (now - entry.mtime > ttlMs) {
        remove(entry.file)
        continue
      }
      survivors.push(entry)
    }
    if (survivors.length > maxEntries) {
      survivors.sort((a, b) => a.mtime - b.mtime)
      for (const entry of survivors.slice(0, survivors.length - maxEntries)) {
        remove(entry.file)
      }
    }
  }

  function valid(record: FormRecord): boolean {
    return (
      !!record &&
      typeof record === "object" &&
      typeof record.id === "string" &&
      typeof record.sessionID === "string" &&
      typeof record.created === "number" &&
      Array.isArray(record.questions)
    )
  }

  return {
    dir,
    save(record: FormRecord): void {
      if (!KEY_RE.test(record.id)) return
      try {
        mkdirSync(formsDir, { recursive: true })
        writeFileSync(join(formsDir, `${record.id}.json`), JSON.stringify(record), "utf8")
        prune()
      } catch {}
    },
    load(key: string, now = Date.now()): FormRecord | undefined {
      if (!KEY_RE.test(key)) return undefined
      const file = join(formsDir, `${key}.json`)
      let mtime: number
      try {
        mtime = statSync(file).mtimeMs
      } catch {
        return undefined
      }
      if (now - mtime > ttlMs) {
        remove(file)
        return undefined
      }
      try {
        const record = JSON.parse(readFileSync(file, "utf8")) as FormRecord
        if (!valid(record) || record.id !== key) return undefined
        return record
      } catch {
        return undefined
      }
    },
    prune,
  }
}

export type FormStore = ReturnType<typeof createFormStore>

export function loadForm(key: string, store: FormStore): FormRecord | undefined {
  const cached = getForm(key)
  if (cached) return cached
  const record = store.load(key)
  if (!record) return undefined
  putForm(record)
  return record
}
