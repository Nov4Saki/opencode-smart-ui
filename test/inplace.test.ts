import assert from "node:assert/strict"
import { test } from "node:test"
import type { PartBridge } from "../src/parts.ts"
import { createAskTool } from "../src/tools/ask.ts"
import { createQuizCheckTool } from "../src/tools/quiz.ts"
import { createRenderTool } from "../src/tools/render.ts"
import { createRevealTool } from "../src/tools/reveal.ts"
import { fakeClient, fakeContext, run } from "./helpers.ts"

function recordingBridge(options: { patch?: boolean; latest?: string | undefined } = {}) {
  const calls = {
    registered: [] as { sessionID: string; key: string; kind: string; art: string[] }[],
    patched: [] as { sessionID: string; key: string; art: string[] }[],
    dropped: [] as string[],
    latest: [] as string[],
  }
  const bridge = {
    register(sessionID: string, key: string, kind: string, art: string[]) {
      calls.registered.push({ sessionID, key, kind, art })
    },
    drop(_sessionID: string, key: string) {
      calls.dropped.push(key)
    },
    has: () => false,
    markLatestRender(sessionID: string, key: string) {
      calls.latest.push(`${sessionID}:${key}`)
    },
    latestRender: () => options.latest,
    bindFromText: () => false,
    removePart: () => {},
    async patch(sessionID: string, key: string, art: string[]) {
      calls.patched.push({ sessionID, key, art })
      return options.patch ?? true
    },
  } as unknown as PartBridge
  return { bridge, calls }
}

test("flashcard deck flips in place through reveal and rating", async () => {
  const { bridge, calls } = recordingBridge()
  const ask = createAskTool({ width: 72, parts: bridge })
  const reveal = createRevealTool({ width: 72, parts: bridge })
  const { context } = fakeContext("inplace-deck")

  const first = await run(ask, { purpose: "quiz", flashcards: true, cards: [{ front: "Capital of France?", back: "Paris" }] }, context)
  assert.equal(calls.registered.length, 1)
  assert.equal(calls.registered[0]!.kind, "flashcard")
  const deckId = first.match(/deckId "([a-z0-9]{6})"/)![1]!
  assert.ok(calls.registered[0]!.art.some((line) => line.includes("Capital of France?")))

  const revealed = await run(reveal, { deckId, cardIndex: 0 }, context)
  assert.ok(!revealed.includes("```"), "no new fence when the card is patched in place")
  assert.ok(revealed.includes("deck card above now shows the answer for card 1/1"))
  assert.ok(revealed.includes("Self rating"))
  assert.equal(calls.patched.length, 1)
  assert.ok(calls.patched[0]!.art.join("\n").includes("Paris"))

  const done = await run(reveal, { deckId, cardIndex: 0, rating: "good" }, context)
  assert.ok(!done.includes("```"))
  assert.ok(done.includes("session summary"))
  assert.equal(calls.patched.length, 2)
  assert.ok(calls.patched[1]!.art.join("\n").includes("session summary"))
  assert.ok(calls.dropped.includes(deckId))
})

test("flashcard flow falls back to the echoed card when patching fails", async () => {
  const { bridge } = recordingBridge({ patch: false })
  const ask = createAskTool({ width: 72, parts: bridge })
  const reveal = createRevealTool({ width: 72, parts: bridge })
  const { context } = fakeContext("inplace-fallback")
  const first = await run(ask, { purpose: "quiz", flashcards: true, cards: [{ front: "Q", back: "ANSWER-FALLBACK" }] }, context)
  const deckId = first.match(/deckId "([a-z0-9]{6})"/)![1]!
  const revealed = await run(reveal, { deckId, cardIndex: 0 }, context)
  assert.ok(revealed.includes("```text"), "legacy fence returns when patching is unavailable")
  assert.ok(revealed.includes("ANSWER-FALLBACK"))
})

test("batch quiz grading marks the original card and still returns the grading fence", async () => {
  const { bridge, calls } = recordingBridge()
  const ask = createAskTool({ width: 72, parts: bridge })
  const check = createQuizCheckTool({ width: 72, parts: bridge })
  const { context } = fakeContext("inplace-quiz")
  const first = await run(
    ask,
    { purpose: "quiz", quiz: [{ question: "2+2?", options: ["3", "4"], answer: "4" }, { question: "Sky color?", options: ["blue", "green"], answer: "blue" }] },
    context,
  )
  assert.equal(calls.registered.length, 1)
  assert.equal(calls.registered[0]!.kind, "quiz")
  const quizId = first.match(/quizId "([a-z0-9]{6})"/)![1]!

  const graded = await run(check, { quizId, answers: [["4"], ["green"]] }, context)
  assert.ok(graded.includes("```text"), "the grading summary is still echoed")
  assert.equal(calls.patched.length, 1)
  const marked = calls.patched[0]!.art.join("\n")
  assert.ok(marked.includes("✓ correct"))
  assert.ok(marked.includes("✗ wrong"))
  assert.ok(marked.includes("answer: blue"))
  assert.ok(calls.dropped.includes(quizId))
})

test("one-at-a-time grading marks each question card in place", async () => {
  const { bridge, calls } = recordingBridge()
  const ask = createAskTool({ width: 72, parts: bridge })
  const check = createQuizCheckTool({ width: 72, parts: bridge })
  const { context } = fakeContext("inplace-quiz-one")
  const first = await run(
    ask,
    {
      purpose: "quiz",
      oneAtATime: true,
      quiz: [
        { question: "2+2?", options: ["3", "4"], answer: "4" },
        { question: "Sky color?", options: ["blue", "green"], answer: "blue" },
      ],
    },
    context,
  )
  const quizId = first.match(/quizId "([a-z0-9]{6})"/)![1]!
  await run(check, { quizId, questionIndex: 0, answers: ["3"] }, context)
  assert.equal(calls.patched.length, 1)
  assert.ok(calls.patched[0]!.art.join("\n").includes("✗ wrong — you: 3 · answer: 4"))

  const second = await run(ask, { purpose: "quiz", quizId, questionIndex: 1 }, context)
  assert.ok(second.includes("Sky color?"))
  assert.equal(calls.registered.length, 2, "serving question 2 re-registers the fresh card")
  await run(check, { quizId, questionIndex: 1, answers: ["blue"] }, context)
  assert.equal(calls.patched.length, 2)
  const final = calls.patched[1]!.art.join("\n")
  assert.ok(final.includes("✓ correct"))
  assert.ok(final.includes("— summary"))
  assert.ok(calls.dropped.includes(quizId))
})

test("render update mode patches the latest card instead of posting a new one", async () => {
  const { bridge, calls } = recordingBridge({ latest: "latest-1" })
  const { client } = fakeClient()
  const render = createRenderTool({ client: client as never, width: 72, parts: bridge })
  const { context } = fakeContext("inplace-render")

  const first = await run(render, { element: { type: "kv", items: [{ label: "a", value: 1 }] } }, context)
  assert.ok(first.includes("```text"))
  assert.equal(calls.registered.length, 1)
  assert.equal(calls.latest.length, 1)

  const updated = await run(render, { element: { type: "kv", items: [{ label: "a", value: 2 }] }, update: true }, context)
  assert.ok(!updated.includes("```"))
  assert.ok(updated.includes("updated in place"))
  assert.equal(calls.patched.length, 1)
  assert.equal(calls.patched[0]!.key, "latest-1")
  assert.ok(calls.patched[0]!.art.join("\n").includes("2"))
  assert.equal(calls.registered.length, 1, "update mode does not register a new card")
})

test("render update mode falls back to a new card when no patch target exists", async () => {
  const { bridge, calls } = recordingBridge({ latest: undefined })
  const { client } = fakeClient()
  const render = createRenderTool({ client: client as never, width: 72, parts: bridge })
  const { context } = fakeContext("inplace-render-fallback")
  const out = await run(render, { element: { type: "kv", items: [{ label: "a", value: 2 }] }, update: true }, context)
  assert.ok(out.includes("```text"))
  assert.equal(calls.registered.length, 1)
})

test("tools behave exactly as before when no part bridge is provided", async () => {
  const ask = createAskTool({ width: 72 })
  const reveal = createRevealTool({ width: 72 })
  const { context } = fakeContext("inplace-none")
  const first = await run(ask, { purpose: "quiz", flashcards: true, cards: [{ front: "Q", back: "A-LEGACY" }] }, context)
  const deckId = first.match(/deckId "([a-z0-9]{6})"/)![1]!
  const revealed = await run(reveal, { deckId, cardIndex: 0 }, context)
  assert.ok(revealed.includes("```text"))
  assert.ok(revealed.includes("A-LEGACY"))
})
