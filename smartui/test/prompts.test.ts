import { test } from "node:test"
import assert from "node:assert/strict"
import { SYSTEM_PROMPT } from "../src/prompts.ts"
import { ELEMENTS } from "../src/show-core.ts"

const OPTION_KEYS = [
  "title",
  "subtitle",
  "unit",
  "height",
  "stacked",
  "percent",
  "alpha",
  "radius",
  "rowLabels",
  "columnLabels",
  "dates",
  "bands",
  "upTo",
  "attribution",
  "group",
  "detail",
  "status",
  "trend",
] as const

test("system prompt documents every element and shared option key", () => {
  for (const element of ELEMENTS) {
    assert.ok(SYSTEM_PROMPT.includes(element), `SYSTEM_PROMPT is missing element "${element}"`)
  }
  for (const key of OPTION_KEYS) {
    assert.ok(SYSTEM_PROMPT.includes(key), `SYSTEM_PROMPT is missing option key "${key}"`)
  }
})

test("system prompt example fence holds valid JSON", () => {
  const match = /```smartui-show\n([^\n]+)\n```/.exec(SYSTEM_PROMPT)
  assert.ok(match, "example smartui-show fence not found in SYSTEM_PROMPT")
  const parsed = JSON.parse(match[1] ?? "") as { element?: string }
  assert.equal(parsed.element, "column")
})
