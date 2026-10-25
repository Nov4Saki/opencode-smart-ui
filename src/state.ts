export type QuizQuestion = {
  header?: string
  question: string
  options: string[]
  descriptions: (string | undefined)[]
  multiple: boolean
  accepted: string[][]
  explanation?: string
}

export type QuizResult = {
  correct: boolean
  given: string[]
}

export type QuizRecord = {
  id: string
  sessionID: string
  title?: string
  intro?: string
  created: number
  mode: "batch" | "one"
  inline: boolean
  questions: QuizQuestion[]
  next: number
  results: (QuizResult | null)[]
}

export type FormKind = "text" | "textarea" | "radio" | "checkbox" | "select"

export type FormQuestion = {
  header?: string
  question: string
  kind: FormKind
  options: string[]
  descriptions: (string | undefined)[]
  placeholder?: string
}

export type FormAnswerEntry = {
  id: string
  label: string
  values: string[]
}

export type FormRecord = {
  id: string
  sessionID: string
  title?: string
  intro?: string
  created: number
  questions: FormQuestion[]
  answers?: { entries: FormAnswerEntry[]; at: number }
}

export const STATE_TTL_MS = 6 * 60 * 60 * 1000
export const QUIZ_LIMIT_PER_SESSION = 32
export const FORM_LIMIT_PER_SESSION = 32

const quizzes = new Map<string, QuizRecord>()
const forms = new Map<string, FormRecord>()

export function newId(): string {
  let id = ""
  while (id.length < 8) id += Math.random().toString(36).slice(2)
  return id.slice(0, 8)
}

export function pruneExpired(now = Date.now()): void {
  for (const record of quizzes.values()) {
    if (now - record.created > STATE_TTL_MS) quizzes.delete(record.id)
  }
  for (const record of forms.values()) {
    if (now - record.created > STATE_TTL_MS) forms.delete(record.id)
  }
}

export function putQuiz(record: QuizRecord): void {
  pruneExpired()
  if (!quizzes.has(record.id)) {
    const sessionRecords = [...quizzes.values()].filter((entry) => entry.sessionID === record.sessionID)
    if (sessionRecords.length >= QUIZ_LIMIT_PER_SESSION) {
      const oldest = sessionRecords.sort((a, b) => a.created - b.created)[0]
      if (oldest) quizzes.delete(oldest.id)
    }
  }
  quizzes.set(record.id, record)
}

export function getQuiz(id: string, now = Date.now()): QuizRecord | undefined {
  pruneExpired(now)
  return quizzes.get(id)
}

export function dropQuiz(id: string): void {
  quizzes.delete(id)
}

export function putForm(record: FormRecord): void {
  pruneExpired()
  if (!forms.has(record.id)) {
    const sessionRecords = [...forms.values()].filter((entry) => entry.sessionID === record.sessionID)
    if (sessionRecords.length >= FORM_LIMIT_PER_SESSION) {
      const oldest = sessionRecords.sort((a, b) => a.created - b.created)[0]
      if (oldest) forms.delete(oldest.id)
    }
  }
  forms.set(record.id, record)
}

export function getForm(id: string, now = Date.now()): FormRecord | undefined {
  pruneExpired(now)
  return forms.get(id)
}

export function dropForm(id: string): void {
  forms.delete(id)
}

export function pendingSummary(sessionID: string, now = Date.now()): string | undefined {
  pruneExpired(now)
  const pending = [...quizzes.values()]
    .filter((record) => record.sessionID === sessionID && record.next < record.questions.length)
    .sort((a, b) => a.created - b.created)
    .map((record) => {
      const label = record.title ? ` "${record.title}"` : ""
      return `quiz ${record.id}${label} — question ${record.next + 1}/${record.questions.length} unanswered`
    })
  const formsPending = [...forms.values()]
    .filter((record) => record.sessionID === sessionID && !record.answers)
    .sort((a, b) => a.created - b.created)
    .map((record) => {
      const label = record.title ? ` "${record.title}"` : ""
      return `form ${record.id}${label} — awaiting submission`
    })
  const all = [...pending, ...formsPending].slice(0, 3)
  return all.length === 0 ? undefined : `pending smartui state: ${all.join("; ")}`
}
