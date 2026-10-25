import { renderElements, type Element } from "./render/elements.ts"
import { bar, formatPct, truncate, wrapText } from "./render/util.ts"

export type QuizQuestionSpec = {
  header: string
  question: string
  options: string[]
  multiple?: boolean
}

export type QuizMode = "batch" | "one"

export type QuizRecord = {
  id: string
  sessionID: string
  title?: string
  intro?: string
  created: number
  questions: QuizQuestionSpec[]
  accepted: string[][]
  explanations: (string | undefined)[]
  mode: QuizMode
  next: number
  rows: QuizRow[]
}

export type QuizRow = {
  question: string
  selected: string[]
  accepted: string[]
  correct: boolean
  explanation?: string
}

export type QuizResult = {
  score: number
  total: number
  pct: number
  rows: QuizRow[]
}

export function parseAccepted(spec: string): string[] {
  return spec
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
}

export function bindAccepted(accepted: string[], labels: string[]): string[] {
  return accepted.map((value) => {
    const lower = value.toLowerCase()
    const exact = labels.find((label) => label.toLowerCase() === lower)
    if (exact) return exact
    const partial = labels.filter((label) => label.toLowerCase().includes(lower))
    if (partial.length === 1) return partial[0]!
    return value
  })
}

export function gradeQuestion(question: QuizQuestionSpec, accepted: string[], raw: string[], explanation?: string): QuizRow {
  const cleaned = raw.map((answer) => answer.trim()).filter(Boolean)
  const skipped = cleaned.length === 0 || (cleaned.length === 1 && cleaned[0]!.toLowerCase() === "unanswered")
  const selected = skipped ? [] : cleaned
  const acceptedSet = new Set(accepted.map((answer) => answer.toLowerCase()))
  const selectedSet = new Set(selected.map((answer) => answer.toLowerCase()))
  const correct =
    selected.length > 0 &&
    (question.multiple
      ? acceptedSet.size > 0 && acceptedSet.size === selectedSet.size && [...acceptedSet].every((answer) => selectedSet.has(answer))
      : selected.every((answer) => acceptedSet.has(answer.toLowerCase())))
  return { question: question.question, selected, accepted, correct, explanation }
}

export function gradeQuiz(record: Pick<QuizRecord, "questions" | "accepted" | "explanations">, answers: string[][]): QuizResult {
  const rows: QuizRow[] = record.questions.map((question, index) =>
    gradeQuestion(question, record.accepted[index] ?? [], answers[index] ?? [], record.explanations[index]),
  )
  const score = rows.filter((row) => row.correct).length
  const pct = rows.length === 0 ? 0 : score / rows.length
  return { score, total: rows.length, pct, rows }
}

export function resultFromRows(rows: QuizRow[]): QuizResult {
  const score = rows.filter((row) => row.correct).length
  const total = rows.length
  return { score, total, pct: total === 0 ? 0 : score / total, rows }
}

export function quizSummary(record: Pick<QuizRecord, "id" | "next" | "questions">): string {
  return `quiz ${record.id} q${Math.min(record.next + 1, record.questions.length)}/${record.questions.length} unanswered`
}

export function renderQuestionFeedback(record: Pick<QuizRecord, "title" | "questions">, row: QuizRow, index: number, maxWidth: number): string[] {
  const header = `${record.title ?? "Quiz"} — question ${index + 1}/${record.questions.length}`
  const lines: string[] = [truncate(header, maxWidth)]
  lines.push(...wrapText(`${row.correct ? "✔" : "✖"} ${row.question}`, maxWidth))
  if (!row.correct) {
    const you = row.selected.length > 0 ? row.selected.join(", ") : "no answer"
    const key = row.accepted.join(" or ") || "(no key)"
    lines.push(...wrapText(`     you: ${you}  ·  correct: ${key}`, maxWidth))
  }
  if (row.explanation) lines.push(...wrapText(`     ${row.explanation}`, maxWidth))
  return lines
}

export function renderQuizSummary(record: Pick<QuizRecord, "title">, rows: QuizRow[], maxWidth: number): string[] {
  const result = resultFromRows(rows)
  const missed = result.total - result.score
  const elements: Element[] = [
    {
      type: "stats",
      title: `${record.title ?? "Study session"} — summary`,
      items: [
        { label: "Score", value: `${result.score}/${result.total}` },
        { label: "Accuracy", value: formatPct(result.pct, 0) },
        { label: "Missed", value: missed },
      ],
    },
    {
      type: "checklist",
      title: "Question review",
      items: rows.map((row, index) => ({
        label: `Q${index + 1} · ${row.question}`,
        status: row.correct ? "done" : "blocked",
      })),
    },
  ]
  return renderElements(elements, { width: maxWidth })
}

function verdict(pct: number): string {
  if (pct >= 1) return "Flawless — nothing left to teach you here."
  if (pct >= 0.8) return "Excellent."
  if (pct >= 0.6) return "Solid."
  if (pct >= 0.4) return "Not bad — the ones you missed are worth a look."
  return "Rough round — want to go over the misses together?"
}

export function renderGrading(record: Pick<QuizRecord, "title">, result: QuizResult, maxWidth: number): string[] {
  const stars = Math.round(result.pct * 3)
  const header = `${record.title ?? "Quiz"} — ${result.score}/${result.total} (${formatPct(result.pct, 0)})`
  const lines: string[] = [truncate(header, maxWidth)]
  lines.push("★".repeat(stars) + "☆".repeat(Math.max(0, 3 - stars)))
  lines.push("[" + bar(result.pct, Math.max(10, Math.min(24, maxWidth - 14))) + "] " + formatPct(result.pct, 0))
  result.rows.forEach((row, index) => {
    const mark = row.correct ? "✔" : "✖"
    const head = `${index + 1}. ${mark} ${row.question}`
    lines.push(...wrapText(head, maxWidth))
    if (row.correct) {
      if (row.explanation) lines.push(...wrapText(`     ${row.explanation}`, maxWidth))
      return
    }
    const you = row.selected.length > 0 ? row.selected.join(", ") : "no answer"
    const key = row.accepted.join(" or ") || "(no key)"
    lines.push(...wrapText(`     you: ${you}  ·  correct: ${key}`, maxWidth))
    if (row.explanation) lines.push(...wrapText(`     ${row.explanation}`, maxWidth))
  })
  lines.push(verdict(result.pct))
  return lines
}
