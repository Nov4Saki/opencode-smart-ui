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

const MARKER_SOURCE = "<!--\\s*smartui:([a-z0-9]{4,12})(?::(?:start|end))?\\s*-->"

export type MarkerPair = { start: string; end: string }

export function markerPair(key: string): MarkerPair {
  return { start: `<!--smartui:${key}:start-->`, end: `<!--smartui:${key}:end-->` }
}

export function echoPlaceholder(key: string, caption: string): string {
  const { start, end } = markerPair(key)
  return `${start}\n_${caption}_\n${end}`
}

function keyMatches(text: string, key: string): boolean {
  return text.includes(`smartui:${key}`)
}

export function applyPayload(text: string, key: string, payload: string): string | null {
  const matches: { index: number; length: number }[] = []
  const re = new RegExp(MARKER_SOURCE, "gi")
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if ((match[1] ?? "").toLowerCase() === key.toLowerCase()) {
      matches.push({ index: match.index, length: match[0].length })
    }
  }
  if (matches.length === 0) return null
  const first = matches[0]!
  const second = matches[1]
  const regionStart = first.index
  const regionEnd = second ? second.index + second.length : first.index + first.length
  const { start, end } = markerPair(key)
  const replacement = `${start}\n${payload}\n${end}`
  return text.slice(0, regionStart) + replacement + text.slice(regionEnd)
}

type PartLike = {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  [key: string]: unknown
}

type ShowCard = {
  key: string
  sessionID: string
  created: number
  payload: string
  bound?: { messageID: string; partID: string; text: string; part?: PartLike }
  patched: boolean
  scans: number
}

export const CARD_TTL_MS = 6 * 60 * 60 * 1000
export const CARDS_PER_SESSION = 96

export type CardBound = {
  messageID: string
  partID: string
  text: string
  part?: unknown
}

export type Bridge = {
  register(sessionID: string, key: string, payload: string): void
  bind(sessionID: string, key: string, bound: CardBound): void
  observeText(sessionID: string, messageID: string, partID: string, part: unknown, text: string): void
  onPartRemoved(messageID: string, partID: string): void
  flushMessage(sessionID: string, messageID: string): Promise<void>
  flushSession(sessionID: string): Promise<void>
  postUserMessage(sessionID: string, text: string): Promise<boolean>
  updatePayload(sessionID: string, key: string, payload: string): Promise<boolean>
  patchPart(sessionID: string, messageID: string, partID: string, text: string, part?: unknown): Promise<boolean>
  fetchPartText(sessionID: string, messageID: string, partID: string): Promise<string | undefined>
}

export function createBridge(deps: {
  client: PluginInput["client"]
  baseUrl?: string
  fetcher?: typeof fetch
  env?: Record<string, string | undefined>
}): Bridge {
  const fetcher = deps.fetcher ?? fetch
  const baseUrl = deps.baseUrl?.replace(/\/+$/, "")
  const cards = new Map<string, ShowCard>()

  function mapKey(sessionID: string, key: string): string {
    return `${sessionID}\u0000${key}`
  }

  function prune(now = Date.now()): void {
    for (const card of cards.values()) {
      if (now - card.created > CARD_TTL_MS) cards.delete(mapKey(card.sessionID, card.key))
    }
  }

  function cardsForSession(sessionID: string): ShowCard[] {
    return [...cards.values()].filter((card) => card.sessionID === sessionID)
  }

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" }
    const env = deps.env ?? process.env
    const password = env.OPENCODE_SERVER_PASSWORD
    if (password) {
      const username = env.OPENCODE_SERVER_USERNAME ?? "opencode"
      headers.authorization = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
    }
    return headers
  }

  async function fetchPartFromServer(sessionID: string, messageID: string, partID: string): Promise<PartLike | undefined> {
    try {
      const client = deps.client.session as unknown as {
        message: (input: { path: { id: string; messageID: string } }) => Promise<unknown>
      }
      const result = await client.message({ path: { id: sessionID, messageID } })
      const payload = ((result as { data?: unknown })?.data ?? result) as { parts?: PartLike[] } | undefined
      return payload?.parts?.find((entry) => entry.id === partID)
    } catch (error) {
      debugLog(`fetch-part-error ${String(error)}`)
      return undefined
    }
  }

  async function refreshBoundText(card: ShowCard): Promise<string | undefined> {
    if (!card.bound) return undefined
    const part = await fetchPartFromServer(card.sessionID, card.bound.messageID, card.bound.partID)
    if (part && typeof part.text === "string") {
      card.bound.part = part
      card.bound.text = part.text
      return part.text
    }
    return card.bound.text
  }

  async function scanSession(sessionID: string, key: string): Promise<boolean> {
    try {
      const client = deps.client.session as unknown as {
        messages: (input: { path: { id: string } }) => Promise<unknown>
      }
      const result = await client.messages({ path: { id: sessionID } })
      const messages = ((result as { data?: unknown })?.data ?? result) as
        | { info?: { id?: string; role?: string }; parts?: PartLike[] }[]
        | undefined
      if (!Array.isArray(messages)) return false
      for (let m = messages.length - 1; m >= 0; m--) {
        const message = messages[m]
        if (message?.info?.role && message.info.role !== "assistant") continue
        const messageID = message?.info?.id
        if (!messageID) continue
        const parts = Array.isArray(message.parts) ? message.parts : []
        for (let p = parts.length - 1; p >= 0; p--) {
          const part = parts[p]!
          if (part.type !== "text" || typeof part.text !== "string") continue
          if (!keyMatches(part.text, key)) continue
          const card = cards.get(mapKey(sessionID, key))
          if (!card) return false
          card.bound = { messageID, partID: part.id, text: part.text, part }
          debugLog(`scan-bound ${key} -> ${part.id}`)
          return true
        }
      }
    } catch (error) {
      debugLog(`scan-error ${String(error)}`)
    }
    return false
  }

  async function patchText(
    sessionID: string,
    messageID: string,
    partID: string,
    part: unknown,
    text: string,
  ): Promise<boolean> {
    if (!baseUrl) return false
    const base = (part as PartLike | undefined) ?? { id: partID, sessionID, messageID, type: "text" }
    const body: PartLike = { ...base, id: partID, sessionID, messageID, type: "text", text }
    const url = `${baseUrl}/session/${encodeURIComponent(sessionID)}/message/${encodeURIComponent(messageID)}/part/${encodeURIComponent(partID)}`
    try {
      const response = await fetcher(url, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body) })
      debugLog(`patch part=${partID} status=${response.status}`)
      return response.ok
    } catch (error) {
      debugLog(`patch-error part=${partID} ${String(error)}`)
      return false
    }
  }

  async function patchCard(card: ShowCard): Promise<boolean> {
    if (!card.bound) return false
    let text = await refreshBoundText(card)
    if (!text) return false
    if (text.includes(card.payload)) {
      card.patched = true
      return true
    }
    let next = applyPayload(text, card.key, card.payload)
    if (next === null) {
      if (!(await scanSession(card.sessionID, card.key))) return false
      text = card.bound!.text
      next = applyPayload(text, card.key, card.payload)
      if (next === null) return false
    }
    if (!card.bound) return false
    const bound = card.bound
    const patched = await patchText(card.sessionID, bound.messageID, bound.partID, bound.part, next)
    if (!patched) return false
    bound.text = next
    bound.part = {
      ...(bound.part ?? {}),
      id: bound.partID,
      sessionID: card.sessionID,
      messageID: bound.messageID,
      type: "text",
      text: next,
    } as PartLike
    card.patched = true
    return true
  }

  async function flush(cardList: ShowCard[]): Promise<void> {
    for (const card of cardList) {
      if (card.patched) continue
      if (!card.bound) {
        if (card.scans >= 3) continue
        card.scans += 1
        if (!(await scanSession(card.sessionID, card.key))) continue
      }
      try {
        await patchCard(card)
      } catch (error) {
        debugLog(`flush-error ${card.key} ${String(error)}`)
      }
    }
  }

  return {
    register(sessionID, key, payload) {
      prune()
      const existing = cardsForSession(sessionID)
      if (existing.length >= CARDS_PER_SESSION) {
        const oldest = existing.sort((a, b) => a.created - b.created)[0]
        if (oldest) cards.delete(mapKey(oldest.sessionID, oldest.key))
      }
      cards.set(mapKey(sessionID, key), { key, sessionID, created: Date.now(), payload, patched: false, scans: 0 })
      debugLog(`register ${sessionID} ${key} bytes=${payload.length}`)
    },
    bind(sessionID, key, bound) {
      const card = cards.get(mapKey(sessionID, key))
      if (!card) return
      card.bound = {
        messageID: bound.messageID,
        partID: bound.partID,
        text: bound.text,
        part: bound.part as PartLike | undefined,
      }
      card.patched = true
      debugLog(`bind ${key} -> ${bound.partID}`)
    },
    observeText(sessionID, messageID, partID, part, text) {
      if (!text.includes("smartui:")) return
      for (const card of cardsForSession(sessionID)) {
        if (card.bound) {
          if (card.bound.partID === partID) card.bound.text = text
          continue
        }
        if (!keyMatches(text, card.key)) continue
        card.bound = { messageID, partID, text, part: part as PartLike }
        debugLog(`bound ${card.key} -> ${partID}`)
      }
    },
    onPartRemoved(messageID, partID) {
      for (const card of cards.values()) {
        if (card.bound && card.bound.partID === partID && card.bound.messageID === messageID) {
          card.bound = undefined
          card.patched = false
        }
      }
    },
    async flushMessage(sessionID, messageID) {
      await flush(
        cardsForSession(sessionID).filter((card) => !card.bound || card.bound.messageID === messageID),
      )
    },
    async flushSession(sessionID) {
      await flush(cardsForSession(sessionID))
    },
    async postUserMessage(sessionID, text) {
      if (!baseUrl) return false
      const url = `${baseUrl}/session/${encodeURIComponent(sessionID)}/message`
      try {
        const response = await fetcher(url, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ parts: [{ type: "text", text }] }),
        })
        debugLog(`inject-message status=${response.status}`)
        return response.ok
      } catch (error) {
        debugLog(`inject-message-error ${String(error)}`)
        return false
      }
    },
    async updatePayload(sessionID, key, payload) {
      const card = cards.get(mapKey(sessionID, key))
      if (!card || card.payload === payload) return false
      card.payload = payload
      card.patched = false
      await flush([card])
      return card.patched
    },
    async patchPart(sessionID, messageID, partID, text, part) {
      return patchText(sessionID, messageID, partID, part, text)
    },
    async fetchPartText(sessionID, messageID, partID) {
      const part = await fetchPartFromServer(sessionID, messageID, partID)
      return part && typeof part.text === "string" ? part.text : undefined
    },
  }
}
