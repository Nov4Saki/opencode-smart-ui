import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createChartStore, defaultDataDir } from "../src/chart-store.ts"

const svg = (label: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><title>${label}</title></svg>`

function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "smartui-store-"))
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  })
  return dir
}

test("server identity round-trips and tolerates corruption", (t) => {
  const dir = tempDir(t)
  const store = createChartStore({ dir })
  assert.equal(store.loadIdentity(), undefined)
  store.saveIdentity({ token: "abcd1234efgh5678", port: 58231 })
  assert.deepEqual(store.loadIdentity(), { token: "abcd1234efgh5678", port: 58231 })
  writeFileSync(join(dir, "chart-server.json"), "{not json", "utf8")
  assert.equal(store.loadIdentity(), undefined)
})

test("charts round-trip on disk and reject bad keys", (t) => {
  const dir = tempDir(t)
  const store = createChartStore({ dir })
  store.writeChart("abc12345", svg("alpha"))
  assert.equal(store.readChart("abc12345")?.svg, svg("alpha"))
  assert.equal(store.readChart("missing99"), undefined)
  assert.throws(() => store.writeChart("../evil", svg("no")))
})

test("expired charts are dropped and deleted on read and prune", (t) => {
  const dir = tempDir(t)
  const store = createChartStore({ dir, ttlMs: 60_000 })
  store.writeChart("fresh001", svg("fresh"))
  store.writeChart("stale001", svg("stale"))
  const old = new Date(Date.now() - 10 * 60_000)
  utimesSync(join(dir, "charts", "stale001.svg"), old, old)
  assert.equal(store.readChart("stale001"), undefined)
  assert.ok(!readdirSync(join(dir, "charts")).includes("stale001.svg"))
  store.writeChart("stale002", svg("stale2"))
  utimesSync(join(dir, "charts", "stale002.svg"), old, old)
  store.prune()
  assert.ok(!readdirSync(join(dir, "charts")).includes("stale002.svg"))
  assert.equal(store.readChart("fresh001")?.svg, svg("fresh"))
})

test("prune keeps only the newest charts beyond the cap", (t) => {
  const dir = tempDir(t)
  const store = createChartStore({ dir, maxEntries: 3 })
  const now = Date.now()
  for (let i = 0; i < 5; i += 1) {
    const key = `chart000${i}`
    store.writeChart(key, svg(key))
    const stamp = new Date(now - (5 - i) * 60_000)
    utimesSync(join(dir, "charts", `${key}.svg`), stamp, stamp)
  }
  store.prune(now)
  const remaining = readdirSync(join(dir, "charts")).sort()
  assert.deepEqual(remaining, ["chart0002.svg", "chart0003.svg", "chart0004.svg"])
})

test("defaultDataDir prefers the SMARTUI_DATA_DIR override", () => {
  assert.equal(defaultDataDir({ SMARTUI_DATA_DIR: "C:\\smartui-data" } as NodeJS.ProcessEnv), "C:\\smartui-data")
  assert.equal(typeof defaultDataDir({} as NodeJS.ProcessEnv), "string")
})
