import { frame, truncate, wrapText } from "./render/util.ts"

export type AskPurpose = "menu" | "form" | "quiz"

export type AskOptionInput = string | { label: string; description?: string }

export type AskQuestionInput = {
  header?: string
  question: string
  options: AskOptionInput[]
  multiple?: boolean
  custom?: boolean
}

export type AskOption = {
  label: string
  description: string
}

export type QuestionSpec = {
  header: string
  question: string
  options: AskOption[]
  multiple: boolean
  custom: boolean
}

const HEADER_MAX = 30
const LABEL_MAX = 32

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function uniqueLabel(label: string, used: Set<string>): string {
  let candidate = label
  let counter = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${label} (${counter})`
    counter += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function normalizeOne(input: AskQuestionInput, purpose: AskPurpose): QuestionSpec {
  const question = collapse(input.question)
  if (!question) throw new Error("question text is required")
  const header = truncate(collapse(input.header ?? "") || question, HEADER_MAX)
  if (input.options.length < 2) throw new Error(`question "${header}" needs at least 2 options`)
  const used = new Set<string>()
  const options = input.options.map((option) => {
    const raw = typeof option === "string" ? { label: option, description: undefined } : option
    const label = uniqueLabel(truncate(collapse(raw.label), LABEL_MAX), used)
    if (!label) throw new Error(`question "${header}" has an empty option label`)
    return { label, description: collapse(raw.description ?? "") }
  })
  const multiple = input.multiple ?? false
  const custom = input.custom ?? (purpose === "form" ? true : false)
  return { header, question, options, multiple, custom }
}

export function normalizeAskQuestions(inputs: AskQuestionInput[], purpose: AskPurpose): QuestionSpec[] {
  if (inputs.length === 0) throw new Error("at least one question is required")
  if (inputs.length > 6) throw new Error("at most 6 questions per ask")
  return inputs.map((input) => normalizeOne(input, purpose))
}

export function questionSpecFrom(question: { header: string; question: string; options: string[]; multiple?: boolean }): QuestionSpec {
  return {
    header: question.header,
    question: question.question,
    options: question.options.map((label) => ({ label, description: "" })),
    multiple: question.multiple ?? false,
    custom: false,
  }
}

export function renderAskCard(options: {
  specs: QuestionSpec[]
  purpose: AskPurpose
  title?: string
  intro?: string
  width: number
  status?: (string | undefined)[]
}): string[] {
  const { specs, purpose, width } = options
  const defaultTitle = purpose === "quiz" ? "Quick quiz" : purpose === "menu" ? "Choose one" : "Fill in"
  const title = truncate(options.title ?? defaultTitle, width - 6)
  const body: string[] = []
  if (options.intro) {
    body.push(...wrapText(options.intro, width - 4))
    body.push("")
  }
  specs.forEach((spec, index) => {
    const head = `${index + 1}. ${spec.question}`
    body.push(...wrapText(head, width - 4))
    spec.options.forEach((option, optionIndex) => {
      const text = `${optionIndex + 1}) ${option.label}${option.description ? ` — ${option.description}` : ""}`
      for (const line of wrapText(text, width - 8)) body.push("   " + line)
    })
    const flags: string[] = []
    if (spec.multiple) flags.push("select all that apply")
    if (spec.custom) flags.push("or type your own answer")
    if (flags.length > 0) body.push("   (" + flags.join(" · ") + ")")
    const mark = options.status?.[index]
    if (mark) {
      for (const line of wrapText(mark, width - 8)) body.push("   " + line)
    }
    if (index < specs.length - 1) body.push("")
  })
  const icon = purpose === "quiz" ? "✎" : purpose === "menu" ? "▸" : "▤"
  return frame({ lines: body, width, title, icon })
}

export function questionCallInstruction(specs: QuestionSpec[], extras?: { quizId?: string; checkTool?: string; questionIndex?: number }): string[] {
  const payload = JSON.stringify({ questions: specs })
  const lines = [
    "NEXT STEP — required: call the `question` tool right now with exactly this argument:",
    payload,
    "Do not paraphrase, reorder, or add questions.",
  ]
  if (extras?.quizId) {
    if (extras.questionIndex !== undefined) {
      lines.push(
        `When the question tool returns, immediately call \`${extras.checkTool ?? "ui_quiz_check"}\` with quizId "${extras.quizId}", questionIndex ${extras.questionIndex} and answers — the user's chosen option label(s) (or the 1-based option number) exactly as shown in the question result.`,
        "Never reveal or hint at the correct answer before grading.",
      )
    } else {
      lines.push(
        `When the question tool returns, immediately call \`${extras.checkTool ?? "ui_quiz_check"}\` with quizId "${extras.quizId}" and answers — an array with one string-array per question (same order) holding the user's chosen option label(s) exactly as shown in the question result.`,
        "Never reveal or hint at the correct answers before grading.",
      )
    }
  } else {
    lines.push("When the question tool returns, continue using the user's answers.")
  }
  return lines
}
