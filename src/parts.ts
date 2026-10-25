import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"

export function debugLog(message: string): void {
  if (process.env.SMARTUI_DEBUG !== "1") return
  try {
    appendFileSync(join(tmpdir(), "smartui-debug.log"), `${new Date().toISOString()} ${message}\n`)
  } catch {}
}

type PartLike = {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  [key: string]: unknown
}

type BoundPart = {
  messageID: string
  partID: string
  part: PartLike
  text: string
}

type CardKind = "quiz" | "flashcard" | "render"

type CardRecord = {
  sessionID: string
  key: string
  kind: CardKind
  sigA: string
  sigB: string
  bound?: BoundPart
  created: number
}

export const CARD_TTL_MS = 6 * 60 * 60 * 1000
export const CARDS_PER_SESSION = 64

const cards = new Map<string, CardRecord>()
const renderHeads = new Map<string, { key: string; created: number }>()

function cardMapKey(sessionID: string, key: string): string {
  return `${sessionID}\u0000${key}`
}

export function artProbes(art: string[]): { sigA: string; sigB: string } {
  const substantive = art.filter((line) => line.trim().length > 0)
  if (substantive.length === 0) return { sigA: "", sigB: "" }
  return {
    sigA: substantive.slice(0, 2).join("\n"),
    sigB: substantive.slice(-2).join("\n"),
  }
}

export function swapFence(text: string, sigA: string, sigB: string, art: string[]): string | null {
  if (!sigA || !sigB) return null
  const crlf = text.includes("\r\n")
  const fence = ["```text", ...art, "```"].join("\n")
  const replacement = crlf ? fence.replace(/\n/g, "\r\n") : fence
  const fencePattern = /```[^\r\n]*[\r\n][\s\S]*?```/g
  let match: RegExpExecArray | null
  while ((match = fencePattern.exec(text)) !== null) {
    const block = match[0]
    const flat = block.includes("\r\n") ? block.replace(/\r\n/g, "\n") : block
    if (flat.includes(sigA) && flat.includes(sigB)) {
      return text.slice(0, match.index) + replacement + text.slice(match.index + block.length)
    }
  }
  return null
}

export function authHeader(env: Record<string, string | undefined> = process.env): string | undefined {
  const password = env.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = env.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
}

export function resolveBaseUrl(input: unknown): string | undefined {
  const withUrl = input as { serverUrl?: URL | string } | undefined
  if (withUrl?.serverUrl) return String(withUrl.serverUrl)
  const client = (input as { client?: { _client?: { baseUrl?: string; getConfig?: () => { baseUrl?: string } } } } | undefined)?.client
  const base = client?._client?.baseUrl ?? client?._client?.getConfig?.().baseUrl
  return base ? String(base) : undefined
}

export type PartBridge = {
  register(sessionID: string, key: string, kind: CardKind, art: string[]): void
  drop(sessionID: string, key: string): void
  has(sessionID: string, key: string): boolean
  markLatestRender(sessionID: string, key: string): void
  latestRender(sessionID: string): string | undefined
  bindFromText(sessionID: string, messageID: string, partID: string, part: unknown, text: string): boolean
  removePart(messageID: string, partID: string): void
  patch(sessionID: string, key: string, art: string[]): Promise<boolean>
}

export function createPartBridge(deps: {
  client: PluginInput["client"]
  baseUrl?: string
  fetcher?: typeof fetch
  env?: Record<string, string | undefined>
  retry?: { attempts?: number; delayMs?: number }
}): PartBridge {
  const fetcher = deps.fetcher ?? fetch
  const baseUrl = deps.baseUrl?.replace(/\/+$/, "")
  const retryAttempts = Math.max(1, deps.retry?.attempts ?? 4)
  const retryDelayMs = deps.retry?.delayMs ?? 200

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function scanForCard(sessionID: string, record: CardRecord): Promise<BoundPart | undefined> {
    try {
      const client = deps.client.session as unknown as {
        messages: (input: { path: { id: string } }) => Promise<unknown>
      }
      const result = (await client.messages({ path: { id: sessionID } })) as {
        data?: { info?: { id?: string; role?: string }; parts?: PartLike[] }[]
      }
      const messages = (result?.data ?? result) as { info?: { id?: string; role?: string }; parts?: PartLike[] }[]
      if (!Array.isArray(messages)) return undefined
      for (let m = messages.length - 1; m >= 0; m--) {
        const message = messages[m]
        const role = message?.info?.role
        if (role && role !== "assistant") continue
        const messageID = message?.info?.id
        if (!messageID) continue
        const parts = Array.isArray(message?.parts) ? message.parts : []
        for (let p = parts.length - 1; p >= 0; p--) {
          const part = parts[p]!
          if (part.type !== "text" || typeof part.text !== "string") continue
          if (!part.text.includes("```")) continue
          if (part.text.includes(record.sigA) && part.text.includes(record.sigB)) {
            return { messageID, partID: part.id, part, text: part.text }
          }
        }
      }
    } catch {}
    return undefined
  }

  function prune(now = Date.now()): void {
    for (const record of cards.values()) {
      if (now - record.created > CARD_TTL_MS) cards.delete(cardMapKey(record.sessionID, record.key))
    }
    for (const [sessionID, head] of renderHeads) {
      if (now - head.created > CARD_TTL_MS) renderHeads.delete(sessionID)
    }
  }

  async function currentText(sessionID: string, bound: BoundPart): Promise<{ text: string; part: PartLike }> {
    try {
      const result = (await deps.client.session.message({ path: { id: sessionID, messageID: bound.messageID } })) as unknown as {
        data?: { parts?: PartLike[] }
        parts?: PartLike[]
      }
      const payload = result?.data ?? result
      const found = payload?.parts?.find((entry) => entry.id === bound.partID)
      if (found && typeof found.text === "string") return { text: found.text, part: found }
    } catch {}
    return { text: bound.text, part: bound.part }
  }

  return {
    register(sessionID, key, kind, art) {
      prune()
      const mapKey = cardMapKey(sessionID, key)
      if (!cards.has(mapKey)) {
        const sessionCards = [...cards.values()].filter((record) => record.sessionID === sessionID)
        if (sessionCards.length >= CARDS_PER_SESSION) {
          const oldest = sessionCards.sort((a, b) => a.created - b.created)[0]
          if (oldest) cards.delete(cardMapKey(oldest.sessionID, oldest.key))
        }
      }
      const probes = artProbes(art)
      cards.set(mapKey, { sessionID, key, kind, sigA: probes.sigA, sigB: probes.sigB, created: Date.now() })
      debugLog(`register ${sessionID} ${key} sigA=${JSON.stringify(probes.sigA)}`)
    },
    drop(sessionID, key) {
      cards.delete(cardMapKey(sessionID, key))
    },
    has(sessionID, key) {
      return cards.has(cardMapKey(sessionID, key))
    },
    markLatestRender(sessionID, key) {
      renderHeads.set(sessionID, { key, created: Date.now() })
    },
    latestRender(sessionID) {
      prune()
      return renderHeads.get(sessionID)?.key
    },
    bindFromText(sessionID, messageID, partID, part, text) {
      debugLog(`bind-scan ${sessionID} ${partID} len=${text.length} fence=${text.includes("```")}`)
      if (!text.includes("```")) return false
      let boundAny = false
      for (const record of cards.values()) {
        if (record.sessionID !== sessionID) continue
        if (record.bound) {
          if (record.bound.partID === partID && typeof (part as PartLike | undefined)?.text === "string") {
            record.bound = { messageID, partID, part: part as PartLike, text }
          }
          continue
        }
        if (!record.sigA) continue
        const hitA = text.includes(record.sigA)
        const hitB = text.includes(record.sigB)
        debugLog(`bind-try ${record.key} hitA=${hitA} hitB=${hitB}`)
        if (hitA && hitB) {
          record.bound = { messageID, partID, part: part as PartLike, text }
          debugLog(`bound ${record.key} -> ${partID}`)
          boundAny = true
        }
      }
      return boundAny
    },
    removePart(messageID, partID) {
      for (const record of cards.values()) {
        if (record.bound?.partID === partID && record.bound.messageID === messageID) record.bound = undefined
      }
    },
    async patch(sessionID, key, art) {
      const record = cards.get(cardMapKey(sessionID, key))
      debugLog(`patch ${key} record=${!!record} bound=${!!record?.bound} base=${baseUrl}`)
      if (!record || !baseUrl) return false
      let resolved: { text: string; part: PartLike } | undefined = record.bound ? await currentText(sessionID, record.bound) : undefined
      let swapped = resolved ? swapFence(resolved.text, record.sigA, record.sigB, art) : null
      for (let attempt = 0; swapped === null && !record.bound && attempt < retryAttempts; attempt++) {
        if (attempt > 0) await sleep(retryDelayMs)
        const scanned = await scanForCard(sessionID, record)
        if (!scanned) continue
        record.bound = scanned
        resolved = { text: scanned.text, part: scanned.part }
        swapped = swapFence(scanned.text, record.sigA, record.sigB, art)
        debugLog(`patch-scan bound=${scanned.partID} swapped=${swapped !== null}`)
      }
      if (swapped === null || !resolved || !record.bound) {
        debugLog(`patch-abort ${key} bound=${!!record.bound} swapped=${swapped !== null}`)
        return false
      }
      const body: PartLike = {
        ...resolved.part,
        id: record.bound.partID,
        sessionID,
        messageID: record.bound.messageID,
        type: "text",
        text: swapped,
      }
      const headers: Record<string, string> = { "content-type": "application/json" }
      const auth = authHeader(deps.env)
      if (auth) headers.authorization = auth
      const url = `${baseUrl}/session/${encodeURIComponent(sessionID)}/message/${encodeURIComponent(record.bound.messageID)}/part/${encodeURIComponent(record.bound.partID)}`
      try {
        const response = await fetcher(url, { method: "PATCH", headers, body: JSON.stringify(body) })
        debugLog(`patch-response status=${response.status} url=${url}`)
        if (!response.ok) return false
      } catch (error) {
        debugLog(`patch-error ${String(error)} url=${url}`)
        return false
      }
      const probes = artProbes(art)
      record.sigA = probes.sigA
      record.sigB = probes.sigB
      record.bound = { messageID: record.bound.messageID, partID: record.bound.partID, part: body, text: swapped }
      return true
    },
  }
}
