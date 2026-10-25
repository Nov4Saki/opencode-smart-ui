import { test } from "node:test"
import assert from "node:assert/strict"
import { createQuizTool } from "../src/tools/quiz.ts"
import { gradeQuestion, normalizeQuizQuestion, normalizeVotes, scoreQuiz, summaryCardMarkdown } from "../src/quiz-core.ts"
import type { QuizRecord } from "../src/state.ts"

function ctx(sessionID: string) {
  return {
    sessionID,
    messageID: "m1",
    agent: "build",
    directory: ".",
    worktree: ".",
    abort: new AbortController().signal,
    metadata() {},
  } as never
}

function text(result: unknown): string {
  if (typeof result === "string") return result
  return String((result as { output?: string }).output ?? "")
}

function quizIdOf(result: string): string {
  const match = result.match(/quizId "([a-z0-9]{8})"/)
  assert.ok(match, "quiz id present in tool output")
  return match![1]!
}

test("normalize binds answer labels case-insensitively and keeps descriptions", () => {
  const question = normalizeQuizQuestion(
    { question: "x?", options: [{ label: "Yes", description: "sure" }, "No"], answer: "yes" },
    0,
  )
  assert.deepEqual(question.accepted, [["Yes"]])
  assert.deepEqual(question.descriptions, ["sure", undefined])
  assert.equal(question.multiple, false)
})

test("normalize rejects unknown answers, duplicates and short option lists", () => {
  assert.throws(() => normalizeQuizQuestion({ question: "x", options: ["a", "b"], answer: "c" }, 0), /does not match/)
  assert.throws(() => normalizeQuizQuestion({ question: "x", options: ["a", "A"], answer: "a" }, 0), /duplicate/)
  assert.throws(() => normalizeQuizQuestion({ question: "x", options: ["a"], answer: "a" }, 0), /at least 2 options/)
})

test("single-choice grading accepts alternatives and 1-based numbers", () => {
  const question = normalizeQuizQuestion({ question: "x", options: ["a", "b", "c"], answer: "a|b" }, 0)
  assert.equal(gradeQuestion(question, ["b"]).correct, true)
  assert.equal(gradeQuestion(question, [2]).correct, true)
  assert.equal(gradeQuestion(question, ["c"]).correct, false)
  assert.deepEqual(gradeQuestion(question, [2]).given, ["b"])
  assert.deepEqual(gradeQuestion(question, ["B"]).given, ["b"])
})

test("multiple-choice grading requires the exact set", () => {
  const question = normalizeQuizQuestion({ question: "x", options: ["a", "b", "c"], answer: "a, b", multiple: true }, 0)
  assert.equal(gradeQuestion(question, ["a", "b"]).correct, true)
  assert.equal(gradeQuestion(question, ["b", "a"]).correct, true)
  assert.equal(gradeQuestion(question, ["a"]).correct, false)
  assert.equal(gradeQuestion(question, ["a", "b", "c"]).correct, false)
  assert.equal(gradeQuestion(question, [1, 2]).correct, true)
})

test("fill-in questions (no options) grade typed answers with alternatives", () => {
  const question = normalizeQuizQuestion({ question: "Capital of Germany?", answer: "Berlin|berlin city" }, 0)
  assert.deepEqual(question.options, [])
  assert.deepEqual(question.accepted, [["Berlin"], ["berlin city"]])
  assert.equal(question.multiple, false)
  assert.equal(gradeQuestion(question, ["  BERLIN "]).correct, true)
  assert.equal(gradeQuestion(question, ["berlin   city"]).correct, true)
  assert.equal(gradeQuestion(question, ["Munich"]).correct, false)
  assert.deepEqual(gradeQuestion(question, [" Berlin "]).given, ["Berlin"])
  assert.throws(() => normalizeQuizQuestion({ question: "x", answer: "a", multiple: true }, 0), /multiple is not allowed/)
  assert.throws(() => normalizeQuizQuestion({ question: "x", answer: " ", options: [] }, 1), /needs a non-empty answer/)
})

test("quiz tool serves and grades a fill-in question end to end", async () => {
  const toolDef = createQuizTool()
  const created = text(
    await toolDef.execute(
      { title: "Geo", questions: [{ question: "Capital of France?", answer: "paris", explanation: "easy" }] },
      ctx("s-quiz-fill"),
    ),
  )
  assert.ok(created.includes("Type your answer"))
  const jsonLine = created.split("\n").find((line) => line.startsWith('{"questions"'))
  assert.ok(jsonLine, "dock JSON present")
  const parsed = JSON.parse(jsonLine!) as { questions: { options: unknown[]; custom?: boolean }[] }
  assert.deepEqual(parsed.questions[0]!.options, [])
  assert.equal(parsed.questions[0]!.custom, true)
  const quizId = quizIdOf(created)
  const graded = text(await toolDef.execute({ quizId, answers: [["  Paris "]] }, ctx("s-quiz-fill")))
  assert.ok(graded.includes("The quiz is complete."))
  assert.ok(graded.includes("1/1 correct (100%)"))
  assert.ok(graded.includes("| Paris | ✓ |"))
})

test("normalizeVotes flattens nested dock answers", () => {
  assert.deepEqual(normalizeVotes([["a", "b"]]), ["a", "b"])
  assert.deepEqual(normalizeVotes(["a"]), ["a"])
  assert.deepEqual(normalizeVotes("x"), ["x"])
  assert.deepEqual(normalizeVotes(null), [])
})

test("summary card reports the score and wrong answers", () => {
  const quiz: QuizRecord = {
    id: "t1",
    sessionID: "s",
    created: Date.now(),
    mode: "batch",
    inline: false,
    questions: [
      normalizeQuizQuestion({ question: "first?", options: ["1", "2"], answer: "1" }, 0),
      normalizeQuizQuestion({ question: "second?", options: ["a", "b"], answer: "b" }, 1),
    ],
    next: 2,
    results: [
      { correct: true, given: ["1"] },
      { correct: false, given: ["a"] },
    ],
  }
  const summary = summaryCardMarkdown(quiz)
  assert.ok(summary.includes("1/2 correct (50%)"))
  assert.ok(summary.includes("correct: b"))
  assert.deepEqual(scoreQuiz(quiz), { correct: 1, answered: 2, total: 2 })
})

test("quiz tool runs a one-at-a-time flow end to end", async () => {
  const toolDef = createQuizTool()
  const created = text(
    await toolDef.execute(
      {
        title: "Math",
        oneAtATime: true,
        questions: [
          { question: "2+2?", options: ["3", "4", "5"], answer: "4" },
          { question: "3+3?", options: ["5", "6"], answer: "6", explanation: "basic addition" },
        ],
      },
      ctx("s-quiz-one"),
    ),
  )
  assert.ok(created.includes("Question 1 of 2 served"))
  assert.ok(created.includes("INLINE CARD"))
  assert.ok(created.includes("write this block into the chat first"))
  assert.ok(created.includes("NEXT STEP"))
  assert.ok(created.includes("do not print this section"))
  const quizId = quizIdOf(created)

  const first = text(await toolDef.execute({ quizId, answers: ["4"] }, ctx("s-quiz-one")))
  assert.ok(first.includes("✓ correct"))
  assert.ok(first.includes("3+3?"), "next question card is included after grading")
  assert.ok(first.includes("NEXT STEP"), "next question is served in the same result")

  const second = text(await toolDef.execute({ quizId, answers: [1] }, ctx("s-quiz-one")))
  assert.ok(second.includes("✗ wrong"))
  assert.ok(second.includes("1/2 correct (50%)"))
  assert.ok(second.includes("basic addition"))

  await assert.rejects(() => toolDef.execute({ quizId, answers: ["4"] }, ctx("s-quiz-one")), /unknown quizId/)
  await assert.rejects(() => toolDef.execute({ quizId }, ctx("s-quiz-other")), /unknown quizId/)
})

test("quiz tool chat mode serves cards without the dock", async () => {
  const toolDef = createQuizTool()
  const created = text(
    await toolDef.execute(
      {
        title: "Math",
        oneAtATime: true,
        inline: true,
        questions: [
          { question: "2+2?", options: ["3", "4"], answer: "4" },
          { question: "3+3?", options: ["5", "6"], answer: "6" },
        ],
      },
      ctx("s-quiz-chat"),
    ),
  )
  assert.ok(created.includes("served in chat"))
  assert.ok(created.includes("INLINE CARD (chat mode)"))
  assert.ok(created.includes("END YOUR TURN"))
  assert.ok(created.includes("_Reply in chat — the label or its number._"))
  assert.ok(!created.includes("NEXT STEP"))
  assert.ok(!created.includes('{"questions"'))
  const quizId = quizIdOf(created)

  const first = text(await toolDef.execute({ quizId, answers: ["4"] }, ctx("s-quiz-chat")))
  assert.ok(first.includes("✓ correct"))
  assert.ok(first.includes("3+3?"))
  assert.ok(first.includes("_Reply in chat — the label or its number._"))
  assert.ok(!first.includes("NEXT STEP"))

  const second = text(await toolDef.execute({ quizId, answers: ["6"] }, ctx("s-quiz-chat")))
  assert.ok(second.includes("2/2 correct (100%)"))
})

test("quiz tool rejects out-of-order answers", async () => {
  const toolDef = createQuizTool()
  const created = text(
    await toolDef.execute(
      { oneAtATime: true, questions: [{ question: "q1", options: ["a", "b"], answer: "a" }, { question: "q2", options: ["c", "d"], answer: "c" }] },
      ctx("s-quiz-order"),
    ),
  )
  const quizId = quizIdOf(created)
  await assert.rejects(() => toolDef.execute({ quizId, answers: ["a"], questionIndex: 1 }, ctx("s-quiz-order")), /out of order/)
})

test("quiz tool batch flow grades every question at once", async () => {
  const toolDef = createQuizTool()
  const created = text(
    await toolDef.execute(
      {
        questions: [
          { question: "Capital of France?", options: ["Paris", "Rome"], answer: "paris" },
          { question: "Pick the evens", options: ["1", "2", "4"], answer: "2, 4", multiple: true },
        ],
      },
      ctx("s-quiz-batch"),
    ),
  )
  assert.ok(created.includes("2 questions"))
  const quizId = quizIdOf(created)
  const graded = text(await toolDef.execute({ quizId, answers: [["paris"], ["2", "4"]] }, ctx("s-quiz-batch")))
  assert.ok(graded.includes("The quiz is complete."))
  assert.ok(graded.includes("2/2 correct (100%)"))
  await assert.rejects(() => toolDef.execute({ quizId, answers: [["paris"], ["2"]] }, ctx("s-quiz-batch")), /unknown quizId/)
})

test("relayed dock JSON always carries option descriptions", async () => {
  const toolDef = createQuizTool()
  const created = text(
    await toolDef.execute(
      { questions: [{ question: "q1", options: ["a", "b"], answer: "a" }] },
      ctx("s-quiz-desc"),
    ),
  )
  const jsonLine = created.split("\n").find((line) => line.startsWith('{"questions"'))
  assert.ok(jsonLine, "dock JSON present")
  const parsed = JSON.parse(jsonLine!) as { questions: { options: { label: string; description?: unknown }[] }[] }
  for (const question of parsed.questions) {
    for (const option of question.options) assert.equal(typeof option.description, "string")
  }
})

test("quiz tool rejects a wrong answer count in batch mode", async () => {
  const toolDef = createQuizTool()
  const created = text(
    await toolDef.execute(
      {
        questions: [
          { question: "q1", options: ["a", "b"], answer: "a" },
          { question: "q2", options: ["c", "d"], answer: "d" },
        ],
      },
      ctx("s-quiz-count"),
    ),
  )
  const quizId = quizIdOf(created)
  await assert.rejects(() => toolDef.execute({ quizId, answers: ["a"] }, ctx("s-quiz-count")), /expected 2 answer entries/)
})
