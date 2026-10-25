import assert from "node:assert/strict"
import { test } from "node:test"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { createAskTool } from "../src/tools/ask.ts"
import { createQuizCheckTool } from "../src/tools/quiz.ts"
import { createRenderTool } from "../src/tools/render.ts"
import { createRevealTool } from "../src/tools/reveal.ts"
import { fakeClient, fakeContext, run } from "./helpers.ts"

const chartElement = {
  elements: [
    {
      type: "chart",
      chart: "bar",
      title: "Sizes",
      data: [
        { label: "core", value: 41 },
        { label: "tui", value: 67 },
      ],
    },
  ],
}

test("ui_render returns fenced art and instructions", async () => {
  const { client } = fakeClient()
  const render = createRenderTool({ client: client as never, width: 72 })
  const { context, titles } = fakeContext()
  const output = await run(render, chartElement, context)
  assert.ok(output.startsWith("```text\n"))
  assert.ok(output.includes("Sizes"))
  assert.ok(output.includes("████"))
  assert.ok(output.includes("verbatim"))
  assert.equal(titles[0], "ui_render · chart")
})

test("ui_render prefill pushes suggest prompt and toast fires", async () => {
  const { client, calls } = fakeClient()
  const render = createRenderTool({ client: client as never, width: 72 })
  const { context } = fakeContext()
  const output = await run(
    render,
    {
      elements: [
        {
          type: "suggest",
          items: [
            { label: "One", prompt: "do the first thing" },
            { label: "Two", prompt: "do the second thing" },
          ],
        },
      ],
      prefill: 2,
      autoSubmit: true,
      toast: { message: "Prefilled", variant: "success" },
    },
    context,
  )
  assert.equal(calls.appendPrompt.length, 1)
  assert.equal(calls.appendPrompt[0]!.body?.text, "do the second thing")
  assert.equal(calls.submitPrompt, 1)
  assert.equal(calls.showToast.length, 1)
  assert.ok(output.includes("prefilled"))
})

test("ui_render rejects bad prefill without a suggest element", async () => {
  const { client } = fakeClient()
  const render = createRenderTool({ client: client as never, width: 72 })
  const { context } = fakeContext()
  await assert.rejects(async () => run(render, { ...chartElement, prefill: 1 }, context), /requires a suggest element/)
})

test("ui_ask menu emits exact question tool JSON", async () => {
  const ask = createAskTool({ width: 72 })
  const { context, titles } = fakeContext()
  const output = await run(
    ask,
    {
      purpose: "menu",
      title: "Stack pick",
      questions: [
        {
          header: "Stack",
          question: "Which stack should we use?",
          options: [
            { label: "React + Vite", description: "fast SPA" },
            { label: "Next.js", description: "SSR" },
          ],
        },
      ],
    },
    context,
  )
  assert.ok(output.includes("NEXT STEP"))
  assert.ok(output.includes("`question` tool"))
  const jsonLine = output.split("\n").find((line) => line.startsWith('{"questions"'))
  assert.ok(jsonLine, "exact JSON line present")
  const payload = JSON.parse(jsonLine!) as { questions: { header: string; options: { label: string }[] }[] }
  assert.equal(payload.questions[0]!.header, "Stack")
  assert.deepEqual(
    payload.questions[0]!.options.map((option) => option.label),
    ["React + Vite", "Next.js"],
  )
  assert.equal(titles[0], "ui_ask · menu (1q)")
})

test("ui_ask quiz + ui_quiz_check grade loop in one session", async () => {
  const ask = createAskTool({ width: 72 })
  const quizCheck = createQuizCheckTool({ width: 72 })
  const { context } = fakeContext("session-42")
  const askOutput = await run(
    ask,
    {
      purpose: "quiz",
      title: "Warm-up",
      quiz: [
        { question: "What is 2+2?", options: ["3", "4"], answer: "4", explanation: "Basic arithmetic." },
        { question: "Vite default port?", options: ["3000", "5173"], answer: "5173 | vite's default" },
      ],
    },
    context,
  )
  const match = askOutput.match(/quizId "([a-z0-9]{6})"/)
  assert.ok(match, "quizId present in instructions")
  const quizId = match![1]!
  const gradeOutput = await run(quizCheck, { quizId, answers: [["4"], ["vite's default"]] }, context)
  assert.ok(gradeOutput.includes("2/2"))
  assert.ok(gradeOutput.includes("★★★"))
  await assert.rejects(async () => run(quizCheck, { quizId, answers: [["4"], ["5173"]] }, context), /unknown quizId/)
})

test("ui_quiz_check rejects quizzes from another session", async () => {
  const ask = createAskTool({ width: 72 })
  const quizCheck = createQuizCheckTool({ width: 72 })
  const { context } = fakeContext("owner")
  const askOutput = await run(
    ask,
    { purpose: "quiz", quiz: [{ question: "Q?", options: ["a", "b"], answer: "a" }] },
    context,
  )
  const quizId = askOutput.match(/quizId "([a-z0-9]{6})"/)![1]!
  const { context: otherContext } = fakeContext("intruder")
  await assert.rejects(async () => run(quizCheck, { quizId, answers: [["a"]] }, otherContext), /unknown quizId/)
})

test("tool zod schemas validate at the boundary", () => {
  const ask = createAskTool({ width: 72 })
  const askSchema = z.object(ask.args as Record<string, z.ZodType>)
  assert.equal(askSchema.safeParse({ purpose: "menu", questions: [{ question: "q", options: ["only-one"] }] }).success, false)
  assert.equal(
    askSchema.safeParse({ purpose: "menu", questions: [{ question: "q", options: ["a", "b"], custom: true }] }).success,
    true,
  )
  const quiz = createQuizCheckTool({ width: 72 })
  const quizSchema = z.object(quiz.args as Record<string, z.ZodType>)
  assert.equal(quizSchema.safeParse({ quizId: "abc123", answers: [["a"], ["b"]] }).success, true)
  assert.equal(quizSchema.safeParse({ quizId: "abc123", answers: "nope" }).success, false)
  assert.equal(quizSchema.safeParse({ quizId: "abc123", questionIndex: 1, answers: ["2"] }).success, true)
  assert.equal(quizSchema.safeParse({ quizId: "abc123", answers: [[1], [2, 3]] }).success, true)
  assert.equal(quizSchema.safeParse({ quizId: "abc123", questionIndex: -1, answers: ["a"] }).success, false)
  assert.equal(
    askSchema.safeParse({ purpose: "quiz", oneAtATime: true, quiz: [{ question: "q", options: ["a", "b"], answer: "a" }] }).success,
    true,
  )
  assert.equal(askSchema.safeParse({ purpose: "quiz", quizId: "abc123", questionIndex: 2 }).success, true)
  assert.equal(askSchema.safeParse({ purpose: "quiz", flashcards: true, cards: [{ front: "f", back: "b" }] }).success, true)
  assert.equal(askSchema.safeParse({ purpose: "quiz", flashcards: true, cards: [] }).success, false)
  const reveal = createRevealTool({ width: 72 })
  const revealSchema = z.object(reveal.args as Record<string, z.ZodType>)
  assert.equal(revealSchema.safeParse({ deckId: "abc123", cardIndex: 0 }).success, true)
  assert.equal(revealSchema.safeParse({ deckId: "abc123", cardIndex: 0, rating: "good" }).success, true)
  assert.equal(revealSchema.safeParse({ deckId: "abc123", cardIndex: 0, rating: "perfect" }).success, false)
  assert.equal(revealSchema.safeParse({ deckId: "abc123", cardIndex: 0, action: "delete" }).success, false)
})

test("ui_render schema accepts every element type", () => {
  const render = createRenderTool({ client: fakeClient().client as never, width: 72 })
  const schema = z.object(render.args as Record<string, z.ZodType>)
  const elements = [
    { type: "chart", chart: "donut", data: [{ label: "a", value: 1 }] },
    { type: "stats", items: [{ label: "x", value: 1 }] },
    { type: "table", columns: ["a"], rows: [["1"]] },
    { type: "checklist", items: [{ label: "x", status: "done" }] },
    { type: "callout", level: "info", body: "hi" },
    { type: "tree", nodes: [{ label: "root", children: [{ label: "kid" }] }] },
    { type: "suggest", items: [{ label: "x", prompt: "p" }] },
    { type: "divider", label: "end" },
    { type: "diff", patch: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b" },
    { type: "kv", items: [{ label: "a", value: 1 }] },
    { type: "badge", items: [{ name: "x", tone: "ok" }] },
    { type: "stepper", steps: [{ label: "a", status: "done" }] },
    { type: "empty", message: "nothing here" },
    { type: "quote", text: "hello", attribution: "me" },
    { type: "footnotes", items: ["note"] },
  ]
  for (const element of elements) {
    const parsed = schema.safeParse({ element })
    assert.ok(parsed.success, `${element.type}: ${JSON.stringify(parsed.error?.issues ?? []).slice(0, 400)}`)
  }
  const batched = schema.safeParse({ elements: elements.slice(0, 8) })
  assert.ok(batched.success, JSON.stringify(batched.error?.issues ?? []).slice(0, 400))
  const dividerOnly = tool.schema.object(render.args as Record<string, z.ZodType>)
  assert.equal(dividerOnly.safeParse({ element: { type: "divider" } }).success, true)
})
