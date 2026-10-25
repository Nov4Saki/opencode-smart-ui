import { test } from "node:test"
import assert from "node:assert/strict"
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFormLogWatcher, desktopLogRoots } from "../src/log-transport.ts"

function fixture(): { root: string; run: string } {
  const root = mkdtempSync(join(tmpdir(), "smartui-log-"))
  const run = join(root, "20261016T182042")
  mkdirSync(run, { recursive: true })
  return { root, run }
}

test("log watcher captures blocked external targets from window.log", () => {
  const { root, run } = fixture()
  const seen: { key: string; query: string }[] = []
  const watcher = createFormLogWatcher({
    roots: [root],
    onSubmission: (submission) => seen.push({ key: submission.key, query: submission.query.toString() }),
  })
  assert.equal(watcher.available(), true)
  writeFileSync(
    join(run, "window.log"),
    "[2026-10-16 21:20:42.363] [warn]          blocked external target { url: 'xmpp://abc12345?user-content-q1=Ada&user-content-q2=Red' }\n",
  )
  watcher.pollNow()
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.key, "abc12345")
  assert.ok(seen[0]!.query.includes("user-content-q1=Ada"))
  assert.ok(seen[0]!.query.includes("user-content-q2=Red"))
})

test("log watcher only reads appended bytes", () => {
  const { root, run } = fixture()
  const seen: string[] = []
  const watcher = createFormLogWatcher({ roots: [root], onSubmission: (submission) => seen.push(submission.key) })
  const file = join(run, "window.log")
  writeFileSync(file, "blocked external target { url: 'xmpp://aaaa1111?x=1' }\n")
  watcher.pollNow()
  assert.deepEqual(seen, ["aaaa1111"])
  appendFileSync(file, "blocked external target { url: 'xmpp://bbbb2222?y=2' }\n")
  watcher.pollNow()
  watcher.pollNow()
  assert.deepEqual(seen, ["aaaa1111", "bbbb2222"])
})

test("log watcher waits for a file that appears later", () => {
  const { root, run } = fixture()
  const seen: string[] = []
  const watcher = createFormLogWatcher({ roots: [root], onSubmission: (submission) => seen.push(submission.key) })
  watcher.pollNow()
  assert.equal(seen.length, 0)
  appendFileSync(join(run, "window.log"), "blocked external target { url: 'xmpp://cccc3333?z=9' }\n")
  watcher.pollNow()
  assert.deepEqual(seen, ["cccc3333"])
})

test("captures the real electron-log multiline format", () => {
  const { root, run } = fixture()
  const seen: { key: string; q1: string }[] = []
  const watcher = createFormLogWatcher({
    roots: [root],
    onSubmission: (submission) => seen.push({ key: submission.key, q1: submission.query.get("user-content-q1") ?? "" }),
  })
  appendFileSync(
    join(run, "window.log"),
    "[2026-10-16 21:50:05.299] [warn]  (window)     blocked external target {\n  url: 'xmpp://probe0001?user-content-probe=probe-1&user-content-q1=test+message'\n}\n",
  )
  watcher.pollNow()
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.key, "probe0001")
  assert.equal(seen[0]!.q1, "test message")
})

test("log watcher carries partial lines across polls", () => {
  const { root, run } = fixture()
  const seen: string[] = []
  const watcher = createFormLogWatcher({ roots: [root], onSubmission: (submission) => seen.push(submission.key) })
  const file = join(run, "window.log")
  appendFileSync(file, "blocked external target { url: 'xmpp://dddd4444?q1=Ne")
  watcher.pollNow()
  assert.equal(seen.length, 0)
  appendFileSync(file, "w' }\n")
  watcher.pollNow()
  assert.deepEqual(seen, ["dddd4444"])
})

test("log watcher decodes form-encoded values", () => {
  const { root, run } = fixture()
  const seen: string[] = []
  const watcher = createFormLogWatcher({
    roots: [root],
    onSubmission: (submission) => seen.push(submission.query.get("user-content-q1") ?? ""),
  })
  appendFileSync(join(run, "window.log"), "xmpp://eeee5555?user-content-q1=hello+world%21\n")
  watcher.pollNow()
  assert.deepEqual(seen, ["hello world!"])
})

test("log watcher resets after truncation", () => {
  const { root, run } = fixture()
  const seen: string[] = []
  const watcher = createFormLogWatcher({ roots: [root], onSubmission: (submission) => seen.push(submission.key) })
  const file = join(run, "window.log")
  appendFileSync(file, "xmpp://ffff6666?a=1\n")
  watcher.pollNow()
  assert.deepEqual(seen, ["ffff6666"])
  writeFileSync(file, "xmpp://g7777?b=2\n")
  watcher.pollNow()
  assert.deepEqual(seen, ["ffff6666", "g7777"])
})

test("log watcher ignores unrelated lines and is unavailable without a logs root", () => {
  const { root, run } = fixture()
  const seen: string[] = []
  const watcher = createFormLogWatcher({ roots: [root], onSubmission: (submission) => seen.push(submission.key) })
  appendFileSync(
    join(run, "window.log"),
    "[error] ResizeObserver loop completed with undelivered notifications.\n[info] nothing to see { url: 'https://example.com' }\n[info] blocked external target { url: 'smartui://deadbeef?q1=x' }\n",
  )
  watcher.pollNow()
  assert.equal(seen.length, 0)
  const missing = createFormLogWatcher({
    roots: [join(tmpdir(), `smartui-missing-${Date.now()}`)],
    onSubmission: () => {},
  })
  assert.equal(missing.available(), false)
  missing.pollNow()
})

test("desktopLogRoots honors the explicit override and APPDATA candidates", () => {
  const roots = desktopLogRoots({
    SMARTUI_FORM_LOG_ROOT: "D:\\custom\\logs",
    APPDATA: "C:\\Users\\x\\AppData\\Roaming",
  })
  assert.equal(roots[0], "D:\\custom\\logs")
  assert.ok(roots.some((root) => root.includes("ai.opencode.desktop")))
  assert.equal(desktopLogRoots({}).length, 0)
})
