export type UiStateKind = "quiz" | "flashcard"

export type UiStateRecord = {
  id: string
  sessionID: string
  kind: UiStateKind
  summary: string
  created: number
  payload: unknown
}

export const STATE_TTL_MS = 6 * 60 * 60 * 1000
export const STATE_LIMIT_PER_SESSION = 64

const records = new Map<string, UiStateRecord>()

export function newUiId(): string {
  let id = ""
  while (id.length < 6) {
    id += Math.random().toString(36).slice(2)
  }
  return id.slice(0, 6)
}

export function pruneExpired(now = Date.now()): void {
  for (const record of records.values()) {
    if (now - record.created > STATE_TTL_MS) records.delete(record.id)
  }
}

export function putState(record: UiStateRecord): void {
  pruneExpired()
  if (!records.has(record.id)) {
    const sessionRecords = [...records.values()].filter((entry) => entry.sessionID === record.sessionID)
    if (sessionRecords.length >= STATE_LIMIT_PER_SESSION) {
      const oldest = sessionRecords.sort((a, b) => a.created - b.created)[0]
      if (oldest) records.delete(oldest.id)
    }
  }
  records.set(record.id, record)
}

export function getState(id: string, now = Date.now()): UiStateRecord | undefined {
  pruneExpired(now)
  return records.get(id)
}

export function dropState(id: string): void {
  records.delete(id)
}

export function pendingSummary(sessionID: string, now = Date.now()): string | undefined {
  pruneExpired(now)
  const pending = [...records.values()]
    .filter((record) => record.sessionID === sessionID)
    .sort((a, b) => a.created - b.created)
    .slice(0, 2)
    .map((record) => record.summary)
  return pending.length === 0 ? undefined : `pending UI state: ${pending.join("; ")}`
}
