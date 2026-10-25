import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeFormQuestion } from "../src/form-core.ts"
import { getForm, putForm } from "../src/state.ts"
import { createAskTool } from "../src/tools/ask.ts"
import { createFormCollectTool } from "../src/tools/form.ts"

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

test("ask tool wraps questions into a dock action", async () => {
  const result = text(
    await createAskTool().execute(
      {
        purpose: "menu",
        title: "Pick",
        questions: [{ question: "Which?", options: ["A", { label: "B", description: "second" }] }],
      },
      ctx("s-ask"),
    ),
  )
  assert.ok(result.includes("**Menu — Pick**"))
  assert.ok(result.includes("`A`"))
  assert.ok(result.includes("INLINE CARD"))
  assert.ok(result.includes("write this block into the chat first"))
  assert.ok(result.includes("do not print this section"))
  const jsonLine = result.split("\n").find((line) => line.startsWith('{"questions"'))
  assert.ok(jsonLine, "dock JSON present")
  const parsed = JSON.parse(jsonLine!) as { questions: { options: { label: string; description?: string }[] }[] }
  assert.deepEqual(parsed.questions[0]!.options, [
    { label: "A", description: "" },
    { label: "B", description: "second" },
  ])
})

test("ask tool chat mode writes the card and skips the dock", async () => {
  const result = text(
    await createAskTool().execute(
      {
        purpose: "menu",
        title: "Pick",
        inline: true,
        questions: [{ question: "Which?", options: ["A", "B"] }],
      },
      ctx("s-ask-chat"),
    ),
  )
  assert.ok(result.includes("INLINE CARD (chat mode)"))
  assert.ok(result.includes("END YOUR TURN"))
  assert.ok(result.includes("Do NOT call the question tool"))
  assert.ok(result.includes("_Reply in chat — the number or the label._"))
  assert.ok(result.includes("1. `A`"))
  assert.ok(!result.includes("NEXT STEP"))
  assert.ok(!result.includes('{"questions"'))
})

test("ask tool supports fill-in questions without options", async () => {
  const result = text(
    await createAskTool().execute(
      { purpose: "form", title: "Profile", questions: [{ question: "What's your name?" }] },
      ctx("s-ask-fill"),
    ),
  )
  assert.ok(result.includes("_Type your answer_"))
  assert.ok(result.includes("**Form — Profile**"))
  const jsonLine = result.split("\n").find((line) => line.startsWith('{"questions"'))
  assert.ok(jsonLine, "dock JSON present")
  const parsed = JSON.parse(jsonLine!) as { questions: { options: unknown[]; custom?: boolean }[] }
  assert.deepEqual(parsed.questions[0]!.options, [])
  assert.equal(parsed.questions[0]!.custom, true)
})

test("form collect tool reports a pending form and then the answers", async () => {
  putForm({
    id: "collect1",
    sessionID: "s-form-collect",
    created: Date.now(),
    questions: [
      normalizeFormQuestion({ header: "Name", question: "Name?" }, 0),
      normalizeFormQuestion({ header: "Colors", question: "Pick colors", multiple: true, options: ["Red", "Blue"] }, 1),
    ],
  })
  const toolDef = createFormCollectTool()
  const pending = text(await toolDef.execute({ key: "collect1" }, ctx("s-form-collect")))
  assert.ok(pending.includes("has not been submitted yet"))
  getForm("collect1")!.answers = {
    entries: [
      { id: "q1", label: "Name", values: ["Ada"] },
      { id: "q2", label: "Colors", values: [] },
    ],
    at: Date.now(),
  }
  const collected = text(await toolDef.execute({ key: "collect1" }, ctx("s-form-collect")))
  assert.ok(collected.includes("- Name: Ada"))
  assert.ok(collected.includes("- Colors: (none selected)"))
  await assert.rejects(() => toolDef.execute({ key: "collect1" }, ctx("s-other")), /unknown key/)
})
