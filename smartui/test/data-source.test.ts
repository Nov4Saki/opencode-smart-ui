import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadDataset, numericColumn, parseDelimited, pickColumn, textColumn } from "../src/data-source.ts"

function dir(): string {
  return mkdtempSync(join(tmpdir(), "smartui-data-"))
}

test("parseDelimited handles quotes, doubled quotes and CRLF", () => {
  const rows = parseDelimited('name,note\r\n"Ada, A","say ""hi"""\r\nBob,plain\r\n', ",")
  assert.deepEqual(rows, [
    ["name", "note"],
    ["Ada, A", 'say "hi"'],
    ["Bob", "plain"],
  ])
})

test("parseDelimited coerces numeric cells and drops blank rows", () => {
  const rows = parseDelimited("a,b\n1,2.5\n\n,\n3,4\n", ",")
  assert.deepEqual(rows, [
    ["a", "b"],
    [1, 2.5],
    [3, 4],
  ])
})

test("TSV parses via tab delimiters", () => {
  const rows = parseDelimited("x\ty\n1\t2\n", "\t")
  assert.deepEqual(rows, [
    ["x", "y"],
    [1, 2],
  ])
})

test("loadDataset reads CSV with a header and exposes column helpers", async () => {
  const base = dir()
  writeFileSync(join(base, "rev.csv"), "quarter,revenue\nQ1,120\nQ2,155\n")
  const dataset = await loadDataset("rev.csv", base)
  assert.equal(dataset.format, "csv")
  assert.deepEqual(dataset.columns, ["quarter", "revenue"])
  assert.deepEqual(textColumn(dataset, "quarter", "label"), ["Q1", "Q2"])
  assert.deepEqual(numericColumn(dataset, "revenue", "value"), [120, 155])
  assert.deepEqual(pickColumn(dataset, 1, "col"), [120, 155])
})

test("loadDataset reads TSV and JSON shapes", async () => {
  const base = dir()
  writeFileSync(join(base, "t.tsv"), "label\tvalue\na\t3\nb\t7\n")
  const tsv = await loadDataset("t.tsv", base)
  assert.equal(tsv.format, "tsv")
  assert.deepEqual(numericColumn(tsv, "value", "value"), [3, 7])

  writeFileSync(join(base, "rows.json"), JSON.stringify({ columns: ["a", "b"], rows: [[1, 2], [3, 4]] }))
  const matrix = await loadDataset("rows.json", base)
  assert.deepEqual(matrix.columns, ["a", "b"])
  assert.deepEqual(matrix.rows, [[1, 2], [3, 4]])

  writeFileSync(join(base, "objects.json"), JSON.stringify([{ n: "x", v: 5 }, { n: "y", v: 6 }]))
  const objects = await loadDataset("objects.json", base)
  assert.deepEqual(objects.columns, ["n", "v"])
  assert.deepEqual(objects.rows, [["x", 5], ["y", 6]])

  writeFileSync(join(base, "flat.json"), JSON.stringify({ values: [10, 20, 30] }))
  const flat = await loadDataset("flat.json", base)
  assert.deepEqual(flat.columns, ["value"])
  assert.deepEqual(flat.rows, [[10], [20], [30]])
})

test("loadDataset sniffs a comma file saved with the wrong extension", async () => {
  const base = dir()
  writeFileSync(join(base, "data.txt"), "a,b\n1,2\n")
  const dataset = await loadDataset("data.txt", base)
  assert.equal(dataset.format, "csv")
  assert.deepEqual(dataset.rows, [[1, 2]])
})

test("loadDataset reports missing files, non-files and unsupported formats", async () => {
  const base = dir()
  await assert.rejects(() => loadDataset("nope.csv", base), /cannot read source/)
  writeFileSync(join(base, "ok.csv"), "a\n1\n")
  await assert.rejects(() => loadDataset({ path: "ok.csv", format: "xml" as never }, base), /format must be/)
  await assert.rejects(() => loadDataset("", base), /must be a file path/)
})

test("loadDataset tries every project root before failing", async () => {
  const empty = dir()
  const real = dir()
  writeFileSync(join(real, "rev.csv"), "quarter,revenue\nQ1,7\n")
  const dataset = await loadDataset("rev.csv", [empty, real])
  assert.deepEqual(dataset.rows, [["Q1", 7]])
  await assert.rejects(() => loadDataset("rev.csv", [empty, dir()]), /tried .*rev\.csv.*, .*rev\.csv/)
})

test("loadDataset retries briefly so a just-written file is still found", async () => {
  const base = dir()
  const target = join(base, "fresh.csv")
  setTimeout(() => writeFileSync(target, "a\n1\n"), 100)
  const dataset = await loadDataset("fresh.csv", base)
  assert.deepEqual(dataset.rows, [[1]])
})

test("loadDataset limits can be relaxed per call", async () => {
  const base = dir()
  writeFileSync(join(base, "wide.csv"), `n\n${"123456789\n".repeat(230_000)}`)
  await assert.rejects(() => loadDataset("wide.csv", base), /too large/)
  const relaxed = await loadDataset("wide.csv", base, { maxBytes: 16 * 1024 * 1024, maxRows: 300_000 })
  assert.equal(relaxed.rows.length, 230_000)
  writeFileSync(join(base, "tall.csv"), `n\n${"1\n".repeat(3000)}`)
  const capped = await loadDataset("tall.csv", base)
  assert.equal(capped.rows.length, 2000)
  const raised = await loadDataset("tall.csv", base, { maxRows: 5000 })
  assert.equal(raised.rows.length, 3000)
})

test("column helpers fail loudly with the available columns", async () => {
  const base = dir()
  writeFileSync(join(base, "rev.csv"), "quarter,revenue\nQ1,120\n")
  const dataset = await loadDataset("rev.csv", base)
  assert.throws(() => numericColumn(dataset, "missing", "value"), /available: quarter, revenue/)
  writeFileSync(join(base, "bad.csv"), "name,tag\nQ1,x\nQ2,y\n")
  const bad = await loadDataset("bad.csv", base)
  assert.throws(() => numericColumn(bad, "name", "value"), /non-numeric values/)
})
