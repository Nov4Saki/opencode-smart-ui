import { normalizeLabel } from "./util.ts"
import type { QuizQuestion, QuizRecord, QuizResult } from "./state.ts"
import type { DockInput, DockQuestion } from "./dock.ts"

export type QuizInputOption = string | { label: string; description?: string }

export type QuizInputQuestion = {
  header?: string
  question: string
  options?: QuizInputOption[]
  answer: string
  multiple?: boolean
  explanation?: string
}

export function optionLists(options: QuizInputOption[]): {
  labels: string[]
  descriptions: (string | undefined)[]
} {
  const labels: string[] = []
  const descriptions: (string | undefined)[] = []
  for (const option of options) {
    if (typeof option === "string") {
      labels.push(option.trim())
      descriptions.push(undefined)
    } else {
      labels.push(option.label.trim())
      descriptions.push(option.description?.trim() || undefined)
    }
  }
  return { labels, descriptions }
}

function findLabel(labels: string[], needle: string): string | undefined {
  const norm = normalizeLabel(needle)
  return labels.find((label) => normalizeLabel(label) === norm)
}

export function normalizeQuizQuestion(input: QuizInputQuestion, index: number): QuizQuestion {
  const where = `question ${index + 1}`
  const question = input.question?.trim()
  if (!question) throw new Error(`smartui_quiz: ${where} needs a non-empty question text`)
  const { labels, descriptions } = optionLists(input.options ?? [])
  const answer = input.answer?.trim()
  if (!answer) throw new Error(`smartui_quiz: ${where} needs a non-empty answer (correct option label)`)
  const multiple = input.multiple === true

  if (labels.length === 0) {
    if (multiple) throw new Error(`smartui_quiz: ${where} is fill-in (no options) — multiple is not allowed`)
    const accepted = answer
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => [part])
    if (accepted.length === 0) throw new Error(`smartui_quiz: ${where} needs at least one accepted answer`)
    return {
      header: input.header?.trim() || undefined,
      question,
      options: [],
      descriptions: [],
      multiple: false,
      accepted,
      explanation: input.explanation?.trim() || undefined,
    }
  }

  if (labels.length < 2) throw new Error(`smartui_quiz: ${where} needs at least 2 options (or omit options for a fill-in question)`)
  const seen = new Set<string>()
  for (const label of labels) {
    if (!label) throw new Error(`smartui_quiz: ${where} has an empty option label`)
    const norm = normalizeLabel(label)
    if (seen.has(norm)) throw new Error(`smartui_quiz: ${where} has duplicate option label "${label}"`)
    seen.add(norm)
  }
  const alternatives = multiple ? answer.split(",") : answer.split("|")
  const accepted: string[][] = []
  if (multiple) {
    const set: string[] = []
    for (const part of alternatives) {
      const trimmed = part.trim()
      if (!trimmed) throw new Error(`smartui_quiz: ${where} answer has an empty entry`)
      const bound = findLabel(labels, trimmed)
      if (!bound) throw new Error(`smartui_quiz: ${where} answer "${trimmed}" does not match any option label`)
      set.push(bound)
    }
    if (set.length < 1) throw new Error(`smartui_quiz: ${where} multiple-choice answer needs at least one label`)
    accepted.push(set)
  } else {
    for (const part of alternatives) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const bound = findLabel(labels, trimmed)
      if (!bound) throw new Error(`smartui_quiz: ${where} answer "${trimmed}" does not match any option label`)
      accepted.push([bound])
    }
    if (accepted.length === 0) throw new Error(`smartui_quiz: ${where} needs at least one accepted answer`)
  }
  return {
    header: input.header?.trim() || undefined,
    question,
    options: labels,
    descriptions,
    multiple,
    accepted,
    explanation: input.explanation?.trim() || undefined,
  }
}

export function canonicalVote(question: QuizQuestion, vote: string | number): string {
  const raw = typeof vote === "number" ? String(vote) : vote
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1
    const byIndex = question.options[index]
    if (byIndex && normalizeLabel(byIndex) !== trimmed) return byIndex
  }
  const bound = findLabel(question.options, trimmed)
  return bound ?? trimmed
}

export function gradeQuestion(question: QuizQuestion, votes: (string | number)[]): QuizResult {
  const given = votes.map((vote) => canonicalVote(question, vote))
  const givenSet = new Set(given.map(normalizeLabel))
  const correct = question.accepted.some((acceptedSet) => {
    const normalized = acceptedSet.map(normalizeLabel)
    return normalized.length === givenSet.size && normalized.every((label) => givenSet.has(label))
  })
  return { correct, given }
}

export function normalizeVotes(answers: unknown): (string | number)[] {
  if (!Array.isArray(answers)) {
    if (typeof answers === "string" || typeof answers === "number") return [answers]
    return []
  }
  const flat = answers.flat(1) as unknown[]
  return flat.filter((entry): entry is string | number => typeof entry === "string" || typeof entry === "number")
}

export function scoreQuiz(quiz: QuizRecord): { correct: number; answered: number; total: number } {
  const answered = quiz.results.filter((result) => result !== null).length
  const correct = quiz.results.filter((result) => result?.correct === true).length
  return { correct, answered, total: quiz.questions.length }
}

function progressRow(quiz: QuizRecord): string {
  return quiz.results
    .map((result, i) => {
      if (!result) return i === quiz.next ? "▶" : "○"
      return result.correct ? "✓" : "✗"
    })
    .join(" ")
}

export function serveCardMarkdown(quiz: QuizRecord, index: number): string {
  const question = quiz.questions[index]!
  const lines: string[] = []
  if (quiz.title) lines.push(`**${quiz.title}** — question ${index + 1} of ${quiz.questions.length}`)
  else lines.push(`**Quiz** — question ${index + 1} of ${quiz.questions.length}`)
  if (quiz.intro) lines.push("", quiz.intro)
  lines.push("", `**${question.header ? `${question.header}: ` : ""}${question.question}**`, "")
  if (question.options.length === 0) {
    lines.push("_Type your answer_")
  } else {
    question.options.forEach((label, i) => {
      const description = question.descriptions[i]
      lines.push(`${i + 1}. ${label}${description ? ` — ${description}` : ""}`)
    })
  }
  if (question.multiple) lines.push("", "_select the complete set_")
  if (quiz.mode === "one") lines.push("", progressRow(quiz))
  return lines.join("\n")
}

export function resultCardMarkdown(quiz: QuizRecord, index: number): string {
  const question = quiz.questions[index]!
  const result = quiz.results[index]!
  const lines: string[] = []
  lines.push(
    `**${quiz.title ?? "Quiz"}** — question ${index + 1} of ${quiz.questions.length} — ${result.correct ? "✓ correct" : "✗ wrong"}`,
  )
  lines.push("", `You answered: ${result.given.join(", ") || "(nothing)"}`)
  if (!result.correct) lines.push(`Correct: ${question.accepted[0]!.join(", ")}`)
  if (question.explanation) lines.push("", `> ${question.explanation}`)
  lines.push("", progressRow(quiz))
  return lines.join("\n")
}

export function summaryCardMarkdown(quiz: QuizRecord): string {
  const { correct, total } = scoreQuiz(quiz)
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0
  const lines: string[] = [
    `**${quiz.title ?? "Quiz"} — summary** · ${correct}/${total} correct (${pct}%)`,
    "",
    "| # | Question | Your answer | Result |",
    "|---|---|---|---|",
  ]
  quiz.questions.forEach((question, i) => {
    const result = quiz.results[i]
    const verdict = !result ? "—" : result.correct ? "✓" : "✗"
    const given = result?.given.join(", ") ?? "—"
    const text = question.question.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 90)
    lines.push(`| ${i + 1} | ${text} | ${given.replace(/\|/g, "\\|")} | ${verdict} |`)
  })
  const wrong = quiz.questions
    .map((question, i) => ({ question, result: quiz.results[i] }))
    .filter((entry) => entry.result && !entry.result.correct)
  if (wrong.length > 0) {
    lines.push("")
    for (const entry of wrong) {
      lines.push(
        `- **${entry.question.question.slice(0, 80)}** — correct: ${entry.question.accepted[0]!.join(", ")}${entry.question.explanation ? ` — ${entry.question.explanation}` : ""}`,
      )
    }
  }
  return lines.join("\n")
}

export function batchServeCardMarkdown(quiz: QuizRecord): string {
  const lines: string[] = [`**${quiz.title ?? "Questionnaire"}** — ${quiz.questions.length} questions`]
  if (quiz.intro) lines.push("", quiz.intro)
  lines.push("")
  quiz.questions.forEach((question, i) => {
    lines.push(`${i + 1}. **${question.header ? `${question.header}: ` : ""}${question.question}**`)
    if (question.options.length === 0) {
      lines.push("   _Type your answer_")
    } else {
      for (const [j, label] of question.options.entries()) {
        const description = question.descriptions[j]
        lines.push(`   ${j + 1}. \`${label}\`${description ? ` — ${description}` : ""}`)
      }
    }
    if (question.multiple) lines.push("   _select all that apply_")
    if (i < quiz.questions.length - 1) lines.push("")
  })
  return lines.join("\n")
}

export function serveDockInput(quiz: QuizRecord, index: number): DockInput {
  const question = quiz.questions[index]!
  const dock: DockQuestion = {
    header: question.header ?? `Question ${index + 1}/${quiz.questions.length}`,
    question: question.question,
    options: question.options.map((label, i) => ({ label, description: question.descriptions[i] ?? "" })),
    multiple: question.multiple,
    custom: question.options.length === 0,
  }
  return { questions: [dock] }
}

export function serveAllDockInput(quiz: QuizRecord): DockInput {
  return {
    questions: quiz.questions.map((question, i) => ({
      header: question.header ?? `Question ${i + 1}/${quiz.questions.length}`,
      question: question.question,
      options: question.options.map((label, j) => ({ label, description: question.descriptions[j] ?? "" })),
      multiple: question.multiple,
      custom: question.options.length === 0,
    })),
  }
}
