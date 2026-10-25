import { debugLog, markerPair, type Bridge } from "./bridge.ts"
import { formCaption, formHtml, normalizeFormQuestion, type FormInputQuestion } from "./form-core.ts"
import type { Surface } from "./options.ts"
import type { ChartPublisher } from "./server.ts"
import { renderShowBlock } from "./show-core.ts"
import { newId, putForm, type FormRecord } from "./state.ts"

export type BlockDeps = {
  bridge: Bridge
  surface: Surface
  charts: ChartPublisher
  baseDirs: string[]
  formAction: (key: string) => Promise<string | undefined>
  onFormRecord?: (record: FormRecord) => void
}

export type BlockProcessor = {
  observe(sessionID: string, messageID: string, partID: string, part: unknown, text: string): void
  forget(messageID: string, partID: string): void
  flushMessage(sessionID: string, messageID: string): Promise<void>
  flushSession(sessionID: string): Promise<void>
}

const FENCE_SOURCE = "```smartui-(show|form)[^\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*```"

type StashedPart = {
  sessionID: string
  messageID: string
  partID: string
  text: string
  part?: unknown
  attempts: number
}

function parseBody(kind: string, body: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    throw new Error(`body is not valid JSON — ${(error as Error).message}`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${kind} block body must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^smartui_(form|show):\s*/, "")
}

export function createBlockProcessor(deps: BlockDeps): BlockProcessor {
  const pending = new Map<string, StashedPart>()
  const inFlight = new Set<string>()

  function mapKey(messageID: string, partID: string): string {
    return `${messageID}\u0000${partID}`
  }

  async function renderForm(
    args: Record<string, unknown>,
    sessionID: string,
    cards: { key: string; payload: string }[],
  ): Promise<string> {
    const rawQuestions = args.questions
    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      throw new Error("needs a non-empty `questions` array")
    }
    if (rawQuestions.length > 8) throw new Error("supports at most 8 questions")
    const questions = rawQuestions.map((question, index) =>
      normalizeFormQuestion(question as FormInputQuestion, index),
    )
    const record: FormRecord = {
      id: newId(),
      sessionID,
      title: typeof args.title === "string" ? args.title : undefined,
      intro: typeof args.intro === "string" ? args.intro : undefined,
      created: Date.now(),
      questions,
    }
    putForm(record)
    deps.onFormRecord?.(record)
    const url = await deps.formAction(record.id)
    if (!url) throw new Error("no capture channel available (desktop log watcher and local form server both unavailable)")
    const payload = `_${formCaption(record)}_\n\n${formHtml(record, url)}`
    cards.push({ key: record.id, payload })
    const { start, end } = markerPair(record.id)
    return `${start}\n${payload}\n${end}`
  }

  async function renderReplacement(
    kind: string,
    body: string,
    sessionID: string,
    cards: { key: string; payload: string }[],
  ): Promise<string> {
    const args = parseBody(kind, body)
    if (kind === "show") return renderShowBlock(args, { surface: deps.surface, charts: deps.charts, baseDirs: deps.baseDirs })
    return renderForm(args, sessionID, cards)
  }

  async function processPart(job: StashedPart, text: string): Promise<"done" | "retry"> {
    const re = new RegExp(FENCE_SOURCE, "g")
    const matches: RegExpExecArray[] = []
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) matches.push(match)
    if (matches.length === 0) return "done"
    let out = ""
    let cursor = 0
    const cards: { key: string; payload: string }[] = []
    for (const hit of matches) {
      out += text.slice(cursor, hit.index)
      cursor = hit.index + hit[0].length
      const kind = hit[1] ?? ""
      try {
        out += await renderReplacement(kind, hit[2] ?? "", job.sessionID, cards)
      } catch (error) {
        const message = cleanError(error)
        debugLog(`block-error ${kind} ${message}`)
        out += `> smartui-${kind} block dropped — ${message}`
      }
    }
    out += text.slice(cursor)
    const patched = await deps.bridge.patchPart(job.sessionID, job.messageID, job.partID, out, job.part)
    if (!patched) {
      debugLog(`block-patch-failed ${job.partID}`)
      return "retry"
    }
    for (const card of cards) {
      deps.bridge.register(job.sessionID, card.key, card.payload)
      deps.bridge.bind(job.sessionID, card.key, {
        messageID: job.messageID,
        partID: job.partID,
        text: out,
        part: job.part,
      })
    }
    debugLog(`block-patched ${job.partID} cards=${cards.length}`)
    return "done"
  }

  async function flushJobs(jobs: StashedPart[]): Promise<void> {
    for (const job of jobs) {
      const key = mapKey(job.messageID, job.partID)
      if (inFlight.has(key)) continue
      inFlight.add(key)
      try {
        const fresh = await deps.bridge.fetchPartText(job.sessionID, job.messageID, job.partID)
        const text = fresh ?? job.text
        if (!text.includes("```smartui-")) {
          pending.delete(key)
          continue
        }
        job.attempts += 1
        const result = await processPart(job, text)
        if (result === "done" || job.attempts >= 2) pending.delete(key)
      } finally {
        inFlight.delete(key)
      }
    }
  }

  return {
    observe(sessionID, messageID, partID, part, text) {
      if (!text.includes("```smartui-")) return
      const key = mapKey(messageID, partID)
      const existing = pending.get(key)
      if (existing) {
        existing.text = text
        existing.part = part
        return
      }
      pending.set(key, { sessionID, messageID, partID, text, part, attempts: 0 })
      debugLog(`block-observe ${partID} session=${sessionID}`)
    },
    forget(messageID, partID) {
      pending.delete(mapKey(messageID, partID))
    },
    async flushMessage(sessionID, messageID) {
      const jobs = [...pending.values()].filter(
        (job) => job.sessionID === sessionID && job.messageID === messageID,
      )
      await flushJobs(jobs)
    },
    async flushSession(sessionID) {
      const jobs = [...pending.values()].filter((job) => job.sessionID === sessionID)
      await flushJobs(jobs)
    },
  }
}
