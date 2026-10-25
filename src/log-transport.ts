import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"
import { debugLog } from "./bridge.ts"

export type LogSubmission = { key: string; query: URLSearchParams }

export const FORM_ACTION_SCHEME = "xmpp"

const SUBMISSION_RE = new RegExp(`${FORM_ACTION_SCHEME}://([a-z0-9]{4,12})\\?([^'"\\s>]*)`, "g")
const MAX_CARRY = 65536

export function desktopLogRoots(env: Record<string, string | undefined>): string[] {
  const roots: string[] = []
  const explicit = env.SMARTUI_FORM_LOG_ROOT
  if (explicit) roots.push(explicit)
  const appData = env.APPDATA
  if (appData) {
    for (const name of ["ai.opencode.desktop", "opencode-desktop", "opencode", "OpenCode"]) {
      roots.push(join(appData, name, "logs"))
    }
  }
  return roots
}

export type FormLogWatcher = {
  available(): boolean
  runDir(): string | undefined
  start(): void
  stop(): void
  pollNow(): void
}

type Cursor = { offset: number; carry: string; decoder: StringDecoder }

export function createFormLogWatcher(options: {
  roots: string[]
  onSubmission: (submission: LogSubmission) => void
  files?: string[]
  pollMs?: number
}): FormLogWatcher {
  const files = options.files ?? ["window.log", "renderer.log"]
  const pollMs = options.pollMs ?? 500
  const cursors = new Map<string, Cursor>()
  let timer: ReturnType<typeof setInterval> | undefined
  let dir: string | undefined

  function latestRunDir(): string | undefined {
    for (const root of options.roots) {
      try {
        const names = readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
        const latest = names[names.length - 1]
        if (latest) return join(root, latest)
      } catch {
        continue
      }
    }
    return undefined
  }

  function scan(text: string): void {
    SUBMISSION_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SUBMISSION_RE.exec(text)) !== null) {
      const key = match[1]!
      const query = new URLSearchParams(match[2] ?? "")
      try {
        options.onSubmission({ key, query })
      } catch (error) {
        debugLog(`form-log-submission-error ${String(error)}`)
      }
    }
  }

  function poll(): void {
    const next = latestRunDir()
    if (!next) return
    if (next !== dir) {
      dir = next
      debugLog(`form-log-run-dir ${dir}`)
    }
    for (const name of files) {
      const file = join(dir, name)
      let cursor = cursors.get(file)
      if (!cursor) {
        cursor = { offset: 0, carry: "", decoder: new StringDecoder("utf8") }
        cursors.set(file, cursor)
      }
      let size: number
      try {
        size = statSync(file).size
      } catch {
        continue
      }
      if (size < cursor.offset) {
        cursor.offset = 0
        cursor.carry = ""
        cursor.decoder = new StringDecoder("utf8")
      }
      if (size === cursor.offset) continue
      try {
        const fd = openSync(file, "r")
        try {
          const buffer = Buffer.alloc(size - cursor.offset)
          readSync(fd, buffer, 0, buffer.length, cursor.offset)
          cursor.offset = size
          const text = cursor.carry + cursor.decoder.write(buffer)
          const lastBreak = text.lastIndexOf("\n")
          if (lastBreak === -1) {
            if (text.length > MAX_CARRY) {
              scan(text)
              cursor.carry = ""
            } else {
              cursor.carry = text
            }
            continue
          }
          cursor.carry = text.slice(lastBreak + 1)
          scan(text.slice(0, lastBreak))
        } finally {
          closeSync(fd)
        }
      } catch (error) {
        debugLog(`form-log-read-error ${String(error)}`)
      }
    }
  }

  return {
    available() {
      return latestRunDir() !== undefined
    },
    runDir() {
      return dir ?? latestRunDir()
    },
    start() {
      if (timer) return
      timer = setInterval(poll, pollMs)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
    pollNow() {
      poll()
    },
  }
}
