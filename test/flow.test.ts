import assert from "node:assert/strict"
import { test } from "node:test"
import { SmartUiPlugin } from "../src/index.ts"
import { createAskTool } from "../src/tools/ask.ts"
import { createQuizCheckTool } from "../src/tools/quiz.ts"
import { createRevealTool } from "../src/tools/reveal.ts"
import { fakeClient, fakeContext, run } from "./helpers.ts"

const SECRET = ["SECRET-EXP-A", "alt-secret-9", "SECRET-EXP-C", "BACK-SECRET-PARIS", "BACK-SECRET-FOUR"]

function assertNoSecret(text: string) {
  for (const secret of SECRET) {
    assert.ok(!text.includes(secret), `leaked "${secret}" in:\n${text}`)
  }
}

test("one-at-a-time quiz full loop with grading, ordering, summary and cleanup", async () => {
  const ask = createAskTool({ width: 72 })
  const quizCheck = createQuizCheckTool({ width: 72 })
  const { context } = fakeContext("study-1")
  const belongingToOther = fakeContext("study-stranger").context

  const first = await run(
    ask,
    {
      purpose: "quiz",
      title: "Warm-up",
      oneAtATime: true,
      quiz: [
        { question: "What is 2+2?", options: ["3", "4"], answer: "4 | four", explanation: "SECRET-EXP-A" },
        { question: "Vite default port?", options: ["3000", "5173"], answer: "5173 | alt-secret-9" },
        { question: "Pick primes", options: ["2", "4", "5"], answer: "2|5", multiple: true, explanation: "SECRET-EXP-C" },
      ],
    },
    context,
  )
  assertNoSecret(first)
  assert.ok(first.includes("What is 2+2?"))
  assert.ok(!first.includes("Vite default port?"), "future questions must not be revealed")
  const jsonLine = first.split("\n").find((line) => line.startsWith('{"questions"'))
  assert.ok(jsonLine)
  const payload = JSON.parse(jsonLine!) as { questions: unknown[] }
  assert.equal(payload.questions.length, 1, "only question 1 goes to the dock")
  const quizId = first.match(/quizId "([a-z0-9]{6})"/)![1]!

  await assert.rejects(async () => run(quizCheck, { quizId, questionIndex: 0, answers: ["4"] }, belongingToOther), /unknown quizId/)
  await assert.rejects(async () => run(quizCheck, { quizId, questionIndex: 2, answers: ["5"] }, context), /out of order/)
  await assert.rejects(async () => run(ask, { purpose: "quiz", quizId, questionIndex: 3 }, context), /out of order/)

  const fb1 = await run(quizCheck, { quizId, questionIndex: 0, answers: ["4"] }, context)
  assert.ok(fb1.includes("question 1/3"))
  assert.ok(fb1.includes("✔"))
  assert.ok(fb1.includes("SECRET-EXP-A"))
  assert.ok(fb1.includes(`questionIndex 1`))

  const second = await run(ask, { purpose: "quiz", quizId, questionIndex: 1 }, context)
  assertNoSecret(second)
  assert.ok(second.includes("Vite default port?"))
  assert.ok(!second.includes("Pick primes"), "question 3 stays hidden")

  const fb2 = await run(quizCheck, { quizId, questionIndex: 1, answers: [2] }, context)
  assert.ok(fb2.includes("✔"), "1-based option number grades correctly")

  const third = await run(ask, { purpose: "quiz", quizId, questionIndex: 2, title: "Warm-up" }, context)
  assertNoSecret(third)
  assert.ok(third.includes("Pick primes"))

  const fb3 = await run(quizCheck, { quizId, questionIndex: 2, answers: ["2", "5"] }, context)
  assert.ok(fb3.includes("summary"))
  assert.ok(fb3.includes("3/3"))
  assert.ok(fb3.includes("Q1"))
  assert.ok(!fb3.includes("questionIndex"), "no next step on the final question")
  await assert.rejects(async () => run(quizCheck, { quizId, questionIndex: 2, answers: ["2"] }, context), /unknown quizId/)
})

test("one-at-a-time feedback on a miss shows the key and explanation", async () => {
  const ask = createAskTool({ width: 72 })
  const quizCheck = createQuizCheckTool({ width: 72 })
  const { context } = fakeContext("study-2")
  const output = await run(
    ask,
    { purpose: "quiz", title: "Check", oneAtATime: true, quiz: [{ question: "Capital of France?", options: ["Lyon", "Paris"], answer: "Paris", explanation: "Paris it is." }] },
    context,
  )
  const quizId = output.match(/quizId "([a-z0-9]{6})"/)![1]!
  const fb = await run(quizCheck, { quizId, questionIndex: 0, answers: ["Lyon"] }, context)
  assert.ok(fb.includes("✖"))
  assert.ok(fb.includes("you: Lyon"))
  assert.ok(fb.includes("correct: Paris"))
  assert.ok(fb.includes("Paris it is."))
  assert.ok(fb.includes("summary"), "single-question quiz ends with the summary")
})

test("batch quiz still grades in one call with numeric answers", async () => {
  const ask = createAskTool({ width: 72 })
  const quizCheck = createQuizCheckTool({ width: 72 })
  const { context } = fakeContext("study-3")
  const output = await run(
    ask,
    { purpose: "quiz", quiz: [
      { question: "Q1", options: ["a", "b"], answer: "b" },
      { question: "Q2", options: ["c", "d"], answer: "c" },
    ] },
    context,
  )
  const quizId = output.match(/quizId "([a-z0-9]{6})"/)![1]!
  const graded = await run(quizCheck, { quizId, answers: [[2], ["c"]] }, context)
  assert.ok(graded.includes("2/2"))
  await assert.rejects(async () => run(quizCheck, { quizId, questionIndex: 0, answers: ["b"] }, context), /unknown quizId/)
})

test("flashcards drive reveal, rating, skip and summary without leaking backs", async () => {
  const ask = createAskTool({ width: 72 })
  const reveal = createRevealTool({ width: 72 })
  const { context } = fakeContext("deck-1")

  const start = await run(
    ask,
    {
      purpose: "quiz",
      title: "Capitals",
      flashcards: true,
      cards: [
        { front: "Capital of France?", back: "BACK-SECRET-PARIS", hint: "city on the Seine" },
        { front: "2+2?", back: "BACK-SECRET-FOUR" },
      ],
    },
    context,
  )
  assertNoSecret(start)
  assert.ok(start.includes("Capital of France?"))
  assert.ok(start.includes('"Reveal answer"'))
  const deckId = start.match(/deckId "([a-z0-9]{6})"/)![1]!

  await assert.rejects(async () => run(reveal, { deckId, cardIndex: 0, rating: "good" }, context), /must be revealed/)
  await assert.rejects(async () => run(reveal, { deckId, cardIndex: 1 }, context), /out of order/)

  const shown = await run(reveal, { deckId, cardIndex: 0 }, context)
  assert.ok(shown.includes("BACK-SECRET-PARIS"))
  assert.ok(shown.includes("hint: city on the Seine"))
  assert.ok(shown.includes('"Again"') && shown.includes('"Easy"'))
  assert.ok(!shown.includes("BACK-SECRET-FOUR"), "later card backs stay hidden")

  const rated = await run(reveal, { deckId, cardIndex: 0, rating: "good" }, context)
  assert.ok(rated.includes("2+2?"))
  assert.ok(rated.includes('"Skip"'))
  assert.ok(!rated.includes("BACK-SECRET-FOUR"))

  const done = await run(reveal, { deckId, cardIndex: 1, action: "skip" }, context)
  assert.ok(done.includes("session summary"))
  assert.ok(done.includes("2/2"))
  assert.ok(done.includes("next in 2d"))
  assert.ok(!done.includes("questionIndex"), "no next step after the deck ends")
  await assert.rejects(async () => run(reveal, { deckId, cardIndex: 1, rating: "good" }, context), /unknown deckId/)
})

test("system.transform injects the pending UI state line per session", async () => {
  const { client } = fakeClient()
  const hooks = await SmartUiPlugin({ client } as never, { width: 72 })
  const transform = hooks["experimental.chat.system.transform"]!
  assert.ok(transform)
  const ask = createAskTool({ width: 72 })
  const { context } = fakeContext("transform-session")
  const output = await run(
    ask,
    { purpose: "quiz", oneAtATime: true, quiz: [{ question: "Q1", options: ["a", "b"], answer: "a" }, { question: "Q2", options: ["c", "d"], answer: "c" }] },
    context,
  )
  const quizId = output.match(/quizId "([a-z0-9]{6})"/)![1]!

  const target = { system: [] as string[] }
  await transform({ sessionID: "transform-session" } as never, target)
  assert.equal(target.system.length, 2)
  assert.ok(target.system[0]!.includes("Smart UI tools"))
  assert.equal(target.system[1], `pending UI state: quiz ${quizId} q1/2 unanswered`)
  assertNoSecret(target.system.join("\n"))

  const untouched = { system: [] as string[] }
  await transform({ sessionID: "somewhere-else" } as never, untouched)
  assert.equal(untouched.system.length, 1)

  const noSession = { system: [] as string[] }
  await transform({} as never, noSession)
  assert.equal(noSession.system.length, 1)
})

test("injectPrompt:false keeps only the state line", async () => {
  const { client } = fakeClient()
  const hooks = await SmartUiPlugin({ client } as never, { width: 72, injectPrompt: false })
  const transform = hooks["experimental.chat.system.transform"]!
  const ask = createAskTool({ width: 72 })
  const { context } = fakeContext("quiet-session")
  const output = await run(ask, { purpose: "quiz", flashcards: true, cards: [{ front: "f", back: "b" }] }, context)
  const deckId = output.match(/deckId "([a-z0-9]{6})"/)![1]!
  const target = { system: [] as string[] }
  await transform({ sessionID: "quiet-session" } as never, target)
  assert.equal(target.system.length, 1)
  assert.ok(target.system[0]!.startsWith("pending UI state: flashcard"))
  assert.ok(target.system[0]!.includes(deckId))
})
