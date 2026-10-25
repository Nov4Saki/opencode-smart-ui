import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBlockProcessor } from "../src/block-core.ts"
import type { Bridge, CardBound } from "../src/bridge.ts"
import type { ChartPublisher } from "../src/server.ts"
import { getForm, type FormRecord } from "../src/state.ts"

type HarnessOptions = {
  serverText?: string
  patchOk?: boolean
  available?: boolean
  baseDir?: string
  onFormRecord?: (record: FormRecord) => void
}

function makeHarness(options: HarnessOptions = {}) {
  const state = {
    registered: [] as { session: string; key: string; payload: string }[],
    bound: [] as { session: string; key: string; bound: CardBound }[],
    patchCalls: [] as { sessionID: string; messageID: string; partID: string; text: string; part: unknown }[],
    serverText: options.serverText,
    patchOk: options.patchOk !== false,
  }
  const bridge: Bridge = {
    register(session, key, payload) {
      state.registered.push({ session, key, payload })
    },
    bind(session, key, bound) {
      state.bound.push({ session, key, bound })
    },
    observeText() {},
    onPartRemoved() {},
    async flushMessage() {},
    async flushSession() {},
    async postUserMessage() {
      return true
    },
    async updatePayload() {
      return true
    },
    async patchPart(sessionID, messageID, partID, text, part) {
      state.patchCalls.push({ sessionID, messageID, partID, text, part })
      if (!state.patchOk) return false
      state.serverText = text
      return true
    },
    async fetchPartText() {
      return state.serverText
    },
  }
  const charts: ChartPublisher = {
    async publish(key) {
      return options.available === false ? undefined : `http://127.0.0.1:1/c/tok/${key}.svg`
    },
    async formUrl(key) {
      return options.available === false ? undefined : `http://127.0.0.1:1/f/tok/${key}`
    },
    async close() {},
  }
  const processor = createBlockProcessor({
    bridge,
    surface: "image",
    charts,
    baseDirs: options.baseDir ? [options.baseDir] : [process.cwd()],
    formAction: async (key) => (options.available === false ? undefined : `xmpp://${key}`),
    onFormRecord: options.onFormRecord,
  })
  return { state, processor }
}

test("show blocks are replaced in place with the rendered chart", async () => {
  const h = makeHarness()
  const text =
    'Intro\n\n```smartui-show\n{"element":"column","title":"Rev","labels":["Q1","Q2"],"series":[{"values":[1,2]}]}\n```\n\nOutro'
  h.processor.observe("s1", "m1", "p1", {}, text)
  await h.processor.flushMessage("s1", "m1")
  assert.equal(h.state.patchCalls.length, 1)
  const patched = h.state.patchCalls[0]!.text
  assert.ok(patched.startsWith("Intro"))
  assert.ok(patched.includes("![Rev](http://127.0.0.1:1/c/tok/"))
  assert.ok(patched.endsWith("Outro"))
  assert.ok(!patched.includes("```smartui-show"))
  assert.equal(h.state.registered.length, 0, "shows register no cards")
  assert.equal(h.state.bound.length, 0)
})

test("panel blocks render as ordinary markdown", async () => {
  const h = makeHarness()
  const text =
    '```smartui-show\n{"element":"stats","title":"Sales","items":[{"label":"Rev","value":"1.2M","delta":"+12%","trend":"up"}]}\n```'
  h.processor.observe("s1", "m1", "p1", {}, text)
  await h.processor.flushMessage("s1", "m1")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(patched.includes("| Metric | Value | Change |"))
  assert.ok(!patched.includes("smartui:"))
  assert.equal(h.state.registered.length, 0)
})

test("chart blocks fall back to text art when the chart server is unavailable", async () => {
  const h = makeHarness({ available: false })
  const text = '```smartui-show\n{"element":"gauge","value":50,"title":"Load"}\n```'
  h.processor.observe("s1", "m1", "p1", {}, text)
  await h.processor.flushMessage("s1", "m1")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(patched.includes("```text"))
  assert.ok(patched.includes("50%"))
})

test("form blocks become a live form with a registered bound card", async () => {
  const h = makeHarness()
  const text =
    '```smartui-form\n{"title":"Launch survey","questions":[{"header":"Name","question":"What is your name?"},{"header":"Vibe","question":"How does it feel?","options":["Fast","Slow"]}]}\n```'
  h.processor.observe("s2", "m2", "p2", { id: "p2" }, text)
  await h.processor.flushMessage("s2", "m2")
  assert.equal(h.state.patchCalls.length, 1)
  const patched = h.state.patchCalls[0]!.text
  assert.equal(h.state.registered.length, 1)
  const key = h.state.registered[0]!.key
  assert.match(key, /^[a-z0-9]{8}$/)
  assert.ok(patched.includes(`<!--smartui:${key}:start-->`))
  assert.ok(patched.includes(`<form action="xmpp://${key}"`))
  assert.ok(patched.includes('name="q1"'))
  assert.ok(patched.includes('type="radio" name="q2" value="Fast" checked'))
  assert.ok(patched.includes("_Form «Launch survey»"))
  const record = getForm(key)
  assert.ok(record, "form record exists")
  assert.equal(record!.sessionID, "s2")
  assert.equal(record!.questions.length, 2)
  assert.equal(h.state.bound.length, 1)
  assert.equal(h.state.bound[0]!.bound.partID, "p2")
  assert.equal(h.state.bound[0]!.bound.text, patched)
  assert.ok(!patched.includes("<textarea"))
})

test("form records are handed to the persistence callback", async () => {
  const saved: FormRecord[] = []
  const h = makeHarness({ onFormRecord: (record) => saved.push(record) })
  const text =
    '```smartui-form\n{"title":"Persist me","questions":[{"question":"Which?","options":["A","B"]}]}\n```'
  h.processor.observe("s2", "m2", "p2", { id: "p2" }, text)
  await h.processor.flushMessage("s2", "m2")
  assert.equal(saved.length, 1)
  const key = h.state.registered[0]!.key
  assert.equal(saved[0]!.id, key)
  assert.equal(saved[0]!.sessionID, "s2")
  assert.equal(JSON.parse(JSON.stringify(saved[0])).id, key)
})

test("invalid form blocks are replaced with a short error note", async () => {
  const h = makeHarness()
  const text = '```smartui-form\n{"questions":[{"question":"Pick","kind":"radio","options":["Only"]}]}\n```'
  h.processor.observe("s2", "m2", "p2", {}, text)
  await h.processor.flushMessage("s2", "m2")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(patched.includes("> smartui-form block dropped —"))
  assert.ok(patched.includes("needs at least 2 options"))
  assert.ok(!patched.includes("smartui_form:"))
  assert.equal(h.state.registered.length, 0)
})

test("invalid JSON and unknown elements produce error notes", async () => {
  const h = makeHarness()
  const text =
    'A\n```smartui-show\n{element: column}\n```\nB\n```smartui-show\n{"element":"pie"}\n```\nC'
  h.processor.observe("s3", "m3", "p3", {}, text)
  await h.processor.flushMessage("s3", "m3")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(patched.includes("> smartui-show block dropped — body is not valid JSON"))
  assert.ok(patched.includes('unknown element "pie"'))
  assert.ok(patched.startsWith("A\n"))
  assert.ok(patched.endsWith("\nC"))
})

test("multiple blocks in one part are all replaced", async () => {
  const h = makeHarness()
  const text =
    '```smartui-show\n{"element":"quote","text":"ship it"}\n```\n\n```smartui-form\n{"questions":[{"question":"Name?"}]}\n```'
  h.processor.observe("s4", "m4", "p4", {}, text)
  await h.processor.flushMessage("s4", "m4")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(patched.includes("> ship it"))
  assert.equal(h.state.registered.length, 1)
  assert.ok(patched.includes(`<!--smartui:${h.state.registered[0]!.key}:start-->`))
})

test("flushing twice does not re-patch", async () => {
  const h = makeHarness()
  const text = '```smartui-show\n{"element":"quote","text":"hi"}\n```'
  h.processor.observe("s5", "m5", "p5", {}, text)
  await h.processor.flushMessage("s5", "m5")
  await h.processor.flushMessage("s5", "m5")
  await h.processor.flushSession("s5")
  assert.equal(h.state.patchCalls.length, 1)
})

test("parts without fences are ignored and forgotten parts are dropped", async () => {
  const h = makeHarness()
  h.processor.observe("s6", "m6", "p6", {}, "plain text, no blocks")
  await h.processor.flushMessage("s6", "m6")
  assert.equal(h.state.patchCalls.length, 0)
  h.processor.observe("s6", "m6", "p7", {}, '```smartui-show\n{"element":"quote","text":"x"}\n```')
  h.processor.forget("m6", "p7")
  await h.processor.flushMessage("s6", "m6")
  assert.equal(h.state.patchCalls.length, 0)
})

test("a part whose server text no longer has fences is skipped", async () => {
  const h = makeHarness()
  h.processor.observe("s7", "m7", "p7", {}, '```smartui-show\n{"element":"quote","text":"hi"}\n```')
  h.state.serverText = "already patched elsewhere"
  await h.processor.flushMessage("s7", "m7")
  assert.equal(h.state.patchCalls.length, 0)
})

test("failed patches retry once through the session flush then give up", async () => {
  const h = makeHarness({ patchOk: false })
  const text = '```smartui-show\n{"element":"quote","text":"hi"}\n```'
  h.state.serverText = text
  h.processor.observe("s8", "m8", "p8", {}, text)
  await h.processor.flushMessage("s8", "m8")
  await h.processor.flushSession("s8")
  await h.processor.flushSession("s8")
  assert.equal(h.state.patchCalls.length, 2)
})

test("overlapping flushes render a form block only once", async () => {
  const saved: FormRecord[] = []
  const h = makeHarness({ onFormRecord: (record) => saved.push(record) })
  const text =
    '```smartui-form\n{"title":"Once","questions":[{"question":"Which?","options":["A","B"]}]}\n```'
  h.processor.observe("s13", "m13", "p13", { id: "p13" }, text)
  await Promise.all([h.processor.flushMessage("s13", "m13"), h.processor.flushSession("s13")])
  assert.equal(saved.length, 1)
  assert.equal(h.state.patchCalls.length, 1)
})

test("a chart block can read its data from a project file via source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smartui-block-"))
  writeFileSync(join(dir, "revenue.csv"), "quarter,revenue\nQ1,120\nQ2,155\nQ3,171\n")
  const h = makeHarness({ baseDir: dir })
  const text = '```smartui-show\n{"element":"bar","title":"Revenue","source":"revenue.csv"}\n```'
  h.processor.observe("s9", "m9", "p9", {}, text)
  await h.processor.flushMessage("s9", "m9")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(!patched.includes("dropped"), patched)
  assert.ok(patched.includes("![Revenue](http://127.0.0.1:1/c/tok/"))
})

test("a source chart resolves string column refs for labels and series", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smartui-block-"))
  writeFileSync(join(dir, "monthly.csv"), "month,revenue\nJan,120\nFeb,155\nMar,171\n")
  const h = makeHarness({ baseDir: dir })
  const text =
    '```smartui-show\n{"element":"line","title":"Monthly","source":"monthly.csv","labels":"month","series":[{"name":"Revenue","values":"revenue"}]}\n```'
  h.processor.observe("s9b", "m9b", "p9b", {}, text)
  await h.processor.flushMessage("s9b", "m9b")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(!patched.includes("dropped"), patched)
  assert.ok(patched.includes("![Monthly](http://127.0.0.1:1/c/tok/"))
})

test("compact inline data strings are expanded before rendering", async () => {
  const h = makeHarness()
  const text = '```smartui-show\n{"element":"column","labels":"Q1,Q2,Q3","values":"1 2 3","title":"C"}\n```'
  h.processor.observe("s10", "m10", "p10", {}, text)
  await h.processor.flushMessage("s10", "m10")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(!patched.includes("dropped"), patched)
  assert.ok(patched.includes("/c/tok/"))
})

test("heatmap blocks accept an inline matrix and column labels", async () => {
  const h = makeHarness()
  const text =
    '```smartui-show\n{"element":"heatmap","title":"Heat","rowLabels":["a","b"],"columnLabels":["x","y"],"matrix":[[1,2],[3,4]]}\n```'
  h.processor.observe("s11", "m11", "p11", {}, text)
  await h.processor.flushMessage("s11", "m11")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(!patched.includes("dropped"), patched)
  assert.ok(patched.includes("/c/tok/"))
})

test("a missing source file becomes a readable error note", async () => {
  const h = makeHarness({ baseDir: tmpdir() })
  const text = '```smartui-show\n{"element":"bar","source":"nope-missing.csv"}\n```'
  h.processor.observe("s12", "m12", "p12", {}, text)
  await h.processor.flushMessage("s12", "m12")
  const patched = h.state.patchCalls[0]!.text
  assert.ok(patched.includes("> smartui-show block dropped —"))
  assert.ok(patched.includes("cannot read source"))
})
