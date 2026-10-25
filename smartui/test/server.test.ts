import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createChartStore } from "../src/chart-store.ts"
import { createChartServer } from "../src/server.ts"

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>`

function serverTemp(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "smartui-server-"))
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  })
  return dir
}

test("chart server publishes and serves svg over http", async () => {
  const charts = createChartServer()
  try {
    const url = await charts.publish("abc12345", SAMPLE)
    assert.ok(url, "publish returns a url")
    const response = await fetch(url!)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "image/svg+xml; charset=utf-8")
    assert.equal(await response.text(), SAMPLE)
  } finally {
    await charts.close()
  }
})

test("chart server 404s unknown keys and wrong tokens", async () => {
  const charts = createChartServer()
  try {
    const url = await charts.publish("abc12345", SAMPLE)
    assert.ok(url)
    const origin = new URL(url!).origin
    const wrongKey = await fetch(`${origin}/c/${"x".repeat(16)}/nokey0001.svg`)
    assert.equal(wrongKey.status, 404)
    const notFound = await fetch(`${origin}/c/${"x".repeat(16)}/missing99.svg`)
    assert.equal(notFound.status, 404)
  } finally {
    await charts.close()
  }
})

test("chart server keeps one origin across publishes", async () => {
  const charts = createChartServer()
  try {
    const first = await charts.publish("key00001", SAMPLE)
    const second = await charts.publish("key00002", SAMPLE)
    assert.ok(first && second)
    assert.equal(new URL(first!).origin, new URL(second!).origin)
    assert.notEqual(first, second)
  } finally {
    await charts.close()
  }
})

test("form route forwards the query to the submit handler", async () => {
  const seen: { key: string; query: string }[] = []
  const charts = createChartServer({
    onFormSubmit: async (key, query) => {
      seen.push({ key, query: query.toString() })
      return { status: 200, html: "<h2>ok</h2>" }
    },
  })
  try {
    const formUrl = await charts.formUrl("form0001")
    assert.ok(formUrl, "formUrl returns a url")
    const response = await fetch(`${formUrl}?user-content-q1=Ada&user-content-q2=Red&user-content-q2=Blue`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
    assert.equal(await response.text(), "<h2>ok</h2>")
    assert.equal(seen.length, 1)
    assert.equal(seen[0]!.key, "form0001")
    assert.ok(seen[0]!.query.includes("user-content-q2=Red"))
    assert.ok(seen[0]!.query.includes("user-content-q2=Blue"))
  } finally {
    await charts.close()
  }
})

test("form route 404s wrong tokens and missing handlers", async () => {
  const withHandler = createChartServer({
    onFormSubmit: async () => ({ status: 200, html: "ok" }),
  })
  const withoutHandler = createChartServer()
  try {
    const formUrl = await withHandler.formUrl("form0001")
    assert.ok(formUrl)
    const origin = new URL(formUrl!).origin
    const wrongToken = await fetch(`${origin}/f/${"x".repeat(16)}/form0001`)
    assert.equal(wrongToken.status, 404)
    const other = await withoutHandler.formUrl("form0001")
    assert.ok(other)
    const noHandler = await fetch(other!)
    assert.equal(noHandler.status, 404)
  } finally {
    await withHandler.close()
    await withoutHandler.close()
  }
})

test("chart urls stay valid across a server restart", async (t) => {
  const dir = serverTemp(t)
  const first = createChartServer({ store: createChartStore({ dir }) })
  const firstUrl = await first.publish("oldkey001", SAMPLE)
  assert.ok(firstUrl)
  await first.close()

  const second = createChartServer({ store: createChartStore({ dir }) })
  try {
    const secondUrl = await second.publish("newkey002", SAMPLE)
    assert.ok(secondUrl)
    assert.equal(new URL(secondUrl!).origin, new URL(firstUrl!).origin)
    const restored = await fetch(firstUrl!)
    assert.equal(restored.status, 200)
    assert.equal(await restored.text(), SAMPLE)
  } finally {
    await second.close()
  }
})

test("falls back to a new port when the persisted one is busy", async (t) => {
  const dir = serverTemp(t)
  const blocker = createServer((_request, response) => {
    response.end("busy")
  })
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()))
  t.after(() => {
    blocker.close()
  })
  const busyPort = (blocker.address() as AddressInfo).port
  createChartStore({ dir }).saveIdentity({ token: "tok12345tok12345", port: busyPort })

  const charts = createChartServer({ store: createChartStore({ dir }) })
  try {
    const url = await charts.publish("key00001", SAMPLE)
    assert.ok(url)
    const parsed = new URL(url!)
    assert.notEqual(Number(parsed.port), busyPort)
    assert.equal(parsed.pathname.split("/")[2], "tok12345tok12345")
    const identity = createChartStore({ dir }).loadIdentity()
    assert.equal(identity?.port, Number(parsed.port))
  } finally {
    await charts.close()
  }
})
