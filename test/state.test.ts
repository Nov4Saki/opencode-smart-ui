import assert from "node:assert/strict"
import { test } from "node:test"
import { STATE_LIMIT_PER_SESSION, STATE_TTL_MS, dropState, getState, newUiId, pendingSummary, putState } from "../src/state.ts"

test("newUiId returns a fresh six-character id", () => {
  const a = newUiId()
  const b = newUiId()
  assert.match(a, /^[a-z0-9]{6}$/)
  assert.notEqual(a, b)
})

test("registry evicts the oldest record past the per-session cap", () => {
  const sessionID = "cap-session"
  const base = Date.now()
  for (let index = 0; index < STATE_LIMIT_PER_SESSION + 1; index += 1) {
    putState({ id: `cap${index}`, sessionID, kind: "quiz", summary: `quiz cap${index}`, created: base - (64 - index), payload: {} })
  }
  assert.equal(getState("cap0"), undefined)
  assert.ok(getState("cap1"))
  assert.ok(getState(`cap${STATE_LIMIT_PER_SESSION}`))
})

test("registry expires records after the TTL", () => {
  const now = Date.now()
  putState({ id: "ttl001", sessionID: "ttl-session", kind: "quiz", summary: "quiz ttl001", created: now, payload: {} })
  assert.ok(getState("ttl001", now + STATE_TTL_MS - 1))
  assert.equal(getState("ttl001", now + STATE_TTL_MS + 1), undefined)
})

test("pendingSummary joins at most two entries for one session", () => {
  const sessionID = "summary-session"
  const now = Date.now()
  putState({ id: "sum001", sessionID, kind: "quiz", summary: "quiz sum001 q1/3 unanswered", created: now, payload: {} })
  putState({ id: "sum002", sessionID, kind: "flashcard", summary: "flashcard sum002 card 1/2 hidden", created: now + 1, payload: {} })
  putState({ id: "sum003", sessionID, kind: "quiz", summary: "quiz sum003 q2/5 unanswered", created: now + 2, payload: {} })
  putState({ id: "sum004", sessionID: "other-session", kind: "quiz", summary: "quiz sum004 q1/1 unanswered", created: now + 3, payload: {} })
  assert.equal(
    pendingSummary(sessionID),
    "pending UI state: quiz sum001 q1/3 unanswered; flashcard sum002 card 1/2 hidden",
  )
  assert.equal(pendingSummary("empty-session"), undefined)
})

test("dropState removes a record", () => {
  putState({ id: "drop01", sessionID: "drop-session", kind: "quiz", summary: "quiz drop01", created: Date.now(), payload: {} })
  assert.ok(getState("drop01"))
  dropState("drop01")
  assert.equal(getState("drop01"), undefined)
})
