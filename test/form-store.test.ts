import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFormStore, loadForm } from "../src/form-store.ts"
import { dropForm, getForm, type FormRecord } from "../src/state.ts"

function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "smartui-form-store-"))
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  })
  return dir
}

function record(id: string): FormRecord {
  return {
    id,
    sessionID: "sess-1",
    title: "Quick",
    created: Date.now(),
    questions: [{ question: "Name?", kind: "text", options: [], descriptions: [] }],
  }
}

test("forms round-trip on disk and reject bad keys", (t) => {
  const dir = tempDir(t)
  const store = createFormStore({ dir })
  assert.equal(store.load("missing99"), undefined)
  const saved = record("form0001")
  store.save(saved)
  assert.deepEqual(store.load("form0001"), saved)
  store.save(record("../evil"))
  assert.equal(store.load("../evil"), undefined)
  assert.deepEqual(readdirSync(join(dir, "forms")), ["form0001.json"])
})

test("loadForm falls back to disk and warms the in-memory registry", (t) => {
  const dir = tempDir(t)
  const store = createFormStore({ dir })
  const saved = record("warm0001")
  store.save(saved)
  assert.equal(getForm("warm0001"), undefined)
  const loaded = loadForm("warm0001", store)
  assert.deepEqual(loaded, saved)
  assert.equal(getForm("warm0001"), loaded)
  t.after(() => dropForm("warm0001"))
})

test("expired and corrupt records are dropped on load", (t) => {
  const dir = tempDir(t)
  const store = createFormStore({ dir, ttlMs: 60_000 })
  store.save(record("stale001"))
  const old = new Date(Date.now() - 10 * 60_000)
  utimesSync(join(dir, "forms", "stale001.json"), old, old)
  assert.equal(store.load("stale001"), undefined)
  assert.ok(!readdirSync(join(dir, "forms")).includes("stale001.json"))

  store.save(record("corrupt01"))
  writeFileSync(join(dir, "forms", "corrupt01.json"), "{not json", "utf8")
  assert.equal(store.load("corrupt01"), undefined)

  store.save(record("mismatch1"))
  writeFileSync(join(dir, "forms", "mismatch1.json"), JSON.stringify(record("other999")), "utf8")
  assert.equal(store.load("mismatch1"), undefined)
})

test("prune keeps only the newest records beyond the cap", (t) => {
  const dir = tempDir(t)
  const store = createFormStore({ dir, maxEntries: 3 })
  const now = Date.now()
  for (let i = 0; i < 5; i += 1) {
    const id = `form000${i}`
    store.save(record(id))
    const stamp = new Date(now - (5 - i) * 60_000)
    utimesSync(join(dir, "forms", `${id}.json`), stamp, stamp)
  }
  store.prune(now)
  const remaining = readdirSync(join(dir, "forms")).sort()
  assert.deepEqual(remaining, ["form0002.json", "form0003.json", "form0004.json"])
})
