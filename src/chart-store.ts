import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const CHART_TTL_MS = 6 * 60 * 60 * 1000
export const MAX_CHARTS = 256

const TOKEN_RE = /^[a-z0-9]{4,32}$/
const KEY_RE = /^[a-z0-9]{4,32}$/

export type ServerIdentity = { token: string; port: number }

export type ChartEntry = { svg: string; created: number }

export type ChartStoreOptions = { dir: string; ttlMs?: number; maxEntries?: number }

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SMARTUI_DATA_DIR
  if (override) return override
  if (process.platform === "win32" && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "opencode-smartui")
  const dataHome = env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(dataHome, "opencode-smartui")
}

export function createChartStore(options: ChartStoreOptions) {
  const dir = options.dir
  const chartsDir = join(dir, "charts")
  const identityFile = join(dir, "chart-server.json")
  const ttlMs = options.ttlMs ?? CHART_TTL_MS
  const maxEntries = options.maxEntries ?? MAX_CHARTS

  function list(): { file: string; key: string; mtime: number }[] {
    let names: string[]
    try {
      names = readdirSync(chartsDir)
    } catch {
      return []
    }
    const entries: { file: string; key: string; mtime: number }[] = []
    for (const name of names) {
      if (!name.endsWith(".svg")) continue
      const file = join(chartsDir, name)
      try {
        entries.push({ file, key: name.slice(0, -4), mtime: statSync(file).mtimeMs })
      } catch {}
    }
    return entries
  }

  function remove(file: string): void {
    try {
      rmSync(file, { force: true })
    } catch {}
  }

  return {
    dir,
    loadIdentity(): Partial<ServerIdentity> | undefined {
      try {
        const raw = JSON.parse(readFileSync(identityFile, "utf8")) as Partial<ServerIdentity>
        const identity: Partial<ServerIdentity> = {}
        if (typeof raw.token === "string" && TOKEN_RE.test(raw.token)) identity.token = raw.token
        if (
          typeof raw.port === "number" &&
          Number.isInteger(raw.port) &&
          raw.port > 0 &&
          raw.port < 65536
        ) {
          identity.port = raw.port
        }
        return Object.keys(identity).length > 0 ? identity : undefined
      } catch {
        return undefined
      }
    },
    saveIdentity(identity: ServerIdentity): void {
      mkdirSync(dir, { recursive: true })
      writeFileSync(identityFile, JSON.stringify(identity), "utf8")
    },
    writeChart(key: string, svg: string): void {
      if (!KEY_RE.test(key)) throw new Error(`invalid chart key "${key}"`)
      mkdirSync(chartsDir, { recursive: true })
      writeFileSync(join(chartsDir, `${key}.svg`), svg, "utf8")
    },
    readChart(key: string, now = Date.now()): ChartEntry | undefined {
      if (!KEY_RE.test(key)) return undefined
      const file = join(chartsDir, `${key}.svg`)
      let created: number
      try {
        created = statSync(file).mtimeMs
      } catch {
        return undefined
      }
      if (now - created > ttlMs) {
        remove(file)
        return undefined
      }
      try {
        return { svg: readFileSync(file, "utf8"), created }
      } catch {
        return undefined
      }
    },
    prune(now = Date.now()): void {
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
    },
  }
}

export type ChartStore = ReturnType<typeof createChartStore>
