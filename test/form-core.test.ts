import { test } from "node:test"
import assert from "node:assert/strict"
import {
  answersFromQuery,
  confirmationPage,
  formatValues,
  formCaption,
  formHtml,
  normalizeFormQuestion,
  submittedMessage,
  submittedReceiptHtml,
} from "../src/form-core.ts"
import type { FormRecord } from "../src/state.ts"

test("normalizeFormQuestion derives kinds from options", () => {
  assert.equal(normalizeFormQuestion({ question: "Name" }, 0).kind, "text")
  assert.equal(normalizeFormQuestion({ question: "Pick", options: ["A", "B"] }, 0).kind, "radio")
  assert.equal(normalizeFormQuestion({ question: "Pick", options: ["A", "B"], multiple: true }, 0).kind, "checkbox")
  assert.equal(normalizeFormQuestion({ question: "Pick", kind: "select", options: ["A", "B"] }, 0).kind, "select")
  const withDescriptions = normalizeFormQuestion({ question: "Pick", options: [{ label: "A", description: "first" }, "B"] }, 0)
  assert.deepEqual(withDescriptions.options, ["A", "B"])
  assert.deepEqual(withDescriptions.descriptions, ["first", undefined])
})

test("normalizeFormQuestion rejects malformed shapes", () => {
  assert.throws(() => normalizeFormQuestion({ question: "X", kind: "slider" as never }, 0), /unknown kind/)
  assert.throws(() => normalizeFormQuestion({ question: "X", kind: "select", options: ["A"] }, 0), /at least 2 options/)
  assert.throws(() => normalizeFormQuestion({ question: "X", options: ["A", "B"] , kind: "text" }, 0), /options are not allowed/)
  assert.throws(() => normalizeFormQuestion({ question: "X", kind: "radio", multiple: true, options: ["A", "B"] }, 0), /multiple:true/)
})

function sampleRecord(): FormRecord {
  return {
    id: "form0001",
    sessionID: "s1",
    title: "Launch <survey>",
    intro: 'Has "quotes" & symbols',
    created: Date.now(),
    questions: [
      normalizeFormQuestion({ question: "Name", header: "Name", placeholder: "Ada" }, 0),
      normalizeFormQuestion({ question: "Notes", kind: "textarea" }, 1),
      normalizeFormQuestion({ question: "Vibe", options: ["Fast", "Slow"] }, 2),
      normalizeFormQuestion({ question: "Colors", options: [{ label: "Red", description: "warm" }, "Blue"], multiple: true }, 3),
      normalizeFormQuestion({ question: "Level", kind: "select", options: ["Low", "High"] }, 4),
    ],
  }
}

test("formHtml escapes content and builds native inputs", () => {
  const record = sampleRecord()
  const html = formHtml(record, "http://127.0.0.1:1/f/tok/form0001")
  assert.ok(html.includes('action="http://127.0.0.1:1/f/tok/form0001"'))
  assert.ok(html.includes('method="get"'))
  assert.ok(html.includes("Launch &lt;survey&gt;"))
  assert.ok(html.includes("&quot;quotes&quot;"))
  assert.ok(html.includes('placeholder="Ada"'))
  assert.ok(html.includes("<textarea"))
  assert.ok(html.includes('type="radio" name="q3" value="Fast" checked'))
  assert.ok(html.includes('type="radio" name="q3" value="Slow">'))
  assert.ok(html.includes('type="checkbox" name="q4" value="Red"'))
  assert.ok(!html.includes('type="checkbox" name="q4" value="Red" checked'))
  assert.ok(html.includes('name="q5"'), "select present")
  assert.ok(html.includes('<option value="Low" selected>'))
  assert.ok(html.includes("warm"))
  assert.ok(!html.includes("\n\n"), "no blank lines")
})

test("answersFromQuery strips prefixes, groups checkboxes, ignores junk", () => {
  const record = sampleRecord()
  const query = new URLSearchParams([
    ["user-content-q1", "Ada"],
    ["q2", "  hello  "],
    ["user-content-q4", "Red"],
    ["user-content-q4", "Blue"],
    ["user-content-q3", ""],
    ["user-content-q9", "out of range"],
    ["user-content-notaquestion", "junk"],
  ])
  const entries = answersFromQuery(record, query)
  assert.deepEqual(entries[0], { id: "q1", label: "Name", values: ["Ada"] })
  assert.deepEqual(entries[1]!.values, ["hello"])
  assert.deepEqual(entries[2]!.values, [], "empty values dropped")
  assert.deepEqual(entries[3]!.values, ["Red", "Blue"])
})

test("formatValues distinguishes checkboxes from other blanks", () => {
  const record = sampleRecord()
  assert.equal(formatValues(record.questions[3]!, []), "(none selected)")
  assert.equal(formatValues(record.questions[0]!, []), "(left blank)")
  assert.equal(formatValues(record.questions[3]!, ["Red", "Blue"]), "Red, Blue")
})

test("submit rendering covers message and confirmation page", () => {
  const record = sampleRecord()
  record.answers = {
    entries: [
      { id: "q1", label: "Name", values: ["Ada"] },
      { id: "q2", label: "Notes", values: [] },
      { id: "q3", label: "Vibe", values: ["Fast"] },
      { id: "q4", label: "Colors", values: [] },
      { id: "q5", label: "Level", values: ["High"] },
    ],
    at: Date.now(),
  }
  const message = submittedMessage(record)
  assert.ok(message.startsWith("Form «Launch <survey>» submitted"))
  assert.ok(message.includes("- Name: Ada"))
  assert.ok(message.includes("- Notes: (left blank)"))
  assert.ok(message.includes("- Colors: (none selected)"))
  assert.ok(message.endsWith("Continue based on these answers."))
  const delivered = confirmationPage(record, true)
  assert.ok(delivered.includes("delivered to opencode"))
  assert.ok(delivered.includes("window.close()"))
  const failed = confirmationPage(record, false)
  assert.ok(failed.includes("Could not deliver"))
  assert.ok(failed.includes(`form ${record.id}`))
})

test("formCaption mentions the question count", () => {
  const record = sampleRecord()
  assert.ok(formCaption(record).includes("5 questions"))
  record.questions = [record.questions[0]!]
  assert.ok(formCaption(record).includes("1 question"))
})

test("form v2 adds an eyebrow row and accent colours", () => {
  const html = formHtml(sampleRecord(), "xmpp://form0001")
  assert.ok(html.includes("smartui form"), "eyebrow label")
  assert.ok(html.includes("text-transform:uppercase"))
  assert.ok(html.includes("accent-color:#2f7cf6"))
  assert.ok(html.includes("<hr style="))
  assert.ok(!html.includes("\n\n"), "no blank lines")
})

test("submittedReceiptHtml summarises the answers without blank lines", () => {
  const record = sampleRecord()
  record.answers = {
    entries: [
      { id: "q1", label: "Name", values: ["Ada"] },
      { id: "q2", label: "Notes", values: [] },
      { id: "q3", label: "Vibe", values: ["Fast"] },
      { id: "q4", label: "Colors", values: ["Red", "Blue"] },
      { id: "q5", label: "Level", values: ["High"] },
    ],
    at: Date.UTC(2026, 9, 17, 8, 30),
  }
  const html = submittedReceiptHtml(record)
  assert.ok(html.includes("✓ submitted"))
  assert.ok(html.includes("Launch &lt;survey&gt;"))
  assert.ok(html.includes("Ada"))
  assert.ok(html.includes("(left blank)"))
  assert.ok(html.includes("Red, Blue"))
  assert.ok(html.includes("2026-10-17 08:30 UTC"))
  assert.ok(!html.includes("\n\n"), "no blank lines")
})
