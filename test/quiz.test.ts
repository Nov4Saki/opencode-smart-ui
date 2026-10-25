import assert from "node:assert/strict"
import { test } from "node:test"
import { normalizeAskQuestions, questionCallInstruction, renderAskCard } from "../src/ask-core.ts"
import { bindAccepted, gradeQuiz, parseAccepted, renderGrading, type QuizRecord } from "../src/quiz-core.ts"

test("parseAccepted splits on pipes and trims", () => {
  assert.deepEqual(parseAccepted(" 5173 | vite's default  | "), ["5173", "vite's default"])
  assert.deepEqual(parseAccepted(""), [])
})

test("bindAccepted maps answer text onto option labels", () => {
  const labels = ["React + Vite (SPA)", "Next.js (App Router)", "SvelteKit"]
  assert.deepEqual(bindAccepted(["next"], labels), ["Next.js (App Router)"])
  assert.deepEqual(bindAccepted(["react + vite (spa)"], labels), ["React + Vite (SPA)"])
  assert.deepEqual(bindAccepted(["Next.js (App Router)"], labels), ["Next.js (App Router)"])
  assert.deepEqual(bindAccepted(["totally custom"], labels), ["totally custom"])
  assert.deepEqual(bindAccepted(["a", "b"], labels), ["a", "b"])
})

test("normalizeAskQuestions clamps headers and dedupes labels", () => {
  const specs = normalizeAskQuestions(
    [
      {
        question: "Which frontend stack should we scaffold for the new admin dashboard project?",
        options: ["React", "react", "Vue"],
      },
    ],
    "menu",
  )
  assert.ok(specs[0]!.header.length <= 30)
  assert.equal(specs[0]!.options[0]!.label, "React")
  assert.equal(specs[0]!.options[1]!.label, "react (2)")
  assert.equal(specs[0]!.custom, false)
  assert.equal(specs[0]!.multiple, false)
})

test("normalizeAskQuestions defaults custom for forms", () => {
  const specs = normalizeAskQuestions([{ question: "Name?", options: ["one", "two"] }], "form")
  assert.equal(specs[0]!.custom, true)
})

test("normalizeAskQuestions rejects too few options and empty asks", () => {
  assert.throws(() => normalizeAskQuestions([{ question: "Q", options: ["only"] }], "menu"), /at least 2 options/)
  assert.throws(() => normalizeAskQuestions([], "menu"), /at least one question/)
})

test("questionCallInstruction embeds parseable exact JSON", () => {
  const specs = normalizeAskQuestions([{ header: "Pick", question: "Which one?", options: ["A", "B"] }], "menu")
  const lines = questionCallInstruction(specs)
  const jsonLine = lines.find((line) => line.startsWith('{"questions"'))
  assert.ok(jsonLine)
  const payload = JSON.parse(jsonLine!) as { questions: typeof specs }
  assert.deepEqual(payload.questions, specs)
  assert.ok(lines.some((line) => line.includes("`question` tool")))
})

test("quiz instruction includes the quizId and grading step", () => {
  const specs = normalizeAskQuestions([{ question: "2+2?", options: ["3", "4"] }], "quiz")
  const lines = questionCallInstruction(specs, { quizId: "abc123" })
  assert.ok(lines.some((line) => line.includes("abc123")))
  assert.ok(lines.some((line) => line.includes("ui_quiz_check")))
})

test("renderAskCard fits the requested width", () => {
  const specs = normalizeAskQuestions(
    [
      { header: "Stack", question: "Which frontend stack should we scaffold?", options: [{ label: "React + Vite", description: "fast dev server" }, { label: "Next.js" }] },
      { header: "Tests", question: "Include tests?", options: ["Yes", "No"], multiple: true, custom: true },
    ],
    "form",
  )
  const lines = renderAskCard({ specs, purpose: "form", title: "Setup", intro: "A couple of quick choices.", width: 60 })
  for (const line of lines) assert.ok([...line].length <= 60, line)
  assert.ok(lines.join("\n").includes("React + Vite"))
  assert.ok(lines.join("\n").includes("select all that apply"))
})

function makeRecord(): QuizRecord {
  return {
    id: "q1",
    sessionID: "s1",
    title: "Warm-up",
    created: 0,
    questions: [
      { header: "Math", question: "What is 2+2?", options: ["3", "4"] },
      { header: "Port", question: "Vite default port?", options: ["3000", "5173"] },
      { header: "Multi", question: "Pick primes", options: ["2", "4", "5"], multiple: true },
    ],
    accepted: [["4"], ["5173", "vite's default"], ["2", "5"]],
    explanations: ["Basic arithmetic.", "Vite uses 5173.", undefined],
    mode: "batch",
    next: 0,
    rows: [],
  }
}

test("gradeQuiz scores exact, alternative, multi, and skipped answers", () => {
  const result = gradeQuiz(makeRecord(), [["4"], ["vite's default"], ["2", "5"]])
  assert.equal(result.score, 3)
  assert.equal(result.pct, 1)
  const partial = gradeQuiz(makeRecord(), [["3"], ["5173"], ["2"]])
  assert.equal(partial.score, 1)
  assert.equal(partial.rows[0]!.correct, false)
  assert.equal(partial.rows[2]!.correct, false)
  const skipped = gradeQuiz(makeRecord(), [["Unanswered"], [], []])
  assert.equal(skipped.score, 0)
  assert.deepEqual(skipped.rows[0]!.selected, [])
})

test("renderGrading shows score, stars, and answer diff", () => {
  const record = makeRecord()
  const result = gradeQuiz(record, [["3"], ["5173"], ["2", "5"]])
  const lines = renderGrading(record, result, 72)
  const text = lines.join("\n")
  assert.ok(text.includes("2/3"))
  assert.ok(text.includes("★"))
  assert.ok(text.includes("correct: 4"))
  assert.ok(text.includes("Basic arithmetic."))
})
