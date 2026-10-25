import assert from "node:assert/strict"
import { test } from "node:test"
import { Raster } from "../src/render/raster.ts"
import { quartiles } from "../src/render/chart.ts"
import { renderElement, renderElements, type Element } from "../src/render/elements.ts"
import { bar, displayWidth, frame, joinColumns, limitHeight, padCenter, truncate, wrapText } from "../src/render/util.ts"

const WIDTH = 72

test("displayWidth treats wide CJK as 2 and combining as 0", () => {
  assert.equal(displayWidth("abc"), 3)
  assert.equal(displayWidth("你好"), 4)
  assert.equal(displayWidth("e\u0301"), 1)
})

test("truncate respects display width", () => {
  assert.equal(truncate("hello world", 8), "hello w…")
  assert.equal(truncate("short", 8), "short")
  assert.ok(displayWidth(truncate("你好世界你好世界", 7)) <= 7)
})

const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}"
const FLAG = "\u{1F1FA}\u{1F1F8}"

test("limitHeight trims long outputs with a count note", () => {
  const short = ["a", "b"]
  assert.equal(limitHeight(short), short)
  const long = Array.from({ length: 50 }, (_, index) => `line ${index}`)
  const trimmed = limitHeight(long)
  assert.equal(trimmed.length, 42)
  assert.equal(trimmed.at(-1), "… +9 more lines")
})

test("oversized elements are clipped to the height budget with their own note", () => {
  const table = renderElement(
    { type: "table", title: "Big", columns: ["n"], rows: Array.from({ length: 60 }, (_, index) => [index]) },
    { width: WIDTH },
  )
  assert.ok(table.length <= 42, String(table.length))
  assert.ok(table.join("\n").includes("more rows"))
  const tree = renderElement(
    { type: "tree", nodes: Array.from({ length: 60 }, (_, index) => ({ label: `node ${index}` })) },
    { width: WIDTH },
  )
  assert.equal(tree.length, 42)
  assert.ok(tree.at(-1)!.includes("more lines"))
})

test("grapheme clusters stay intact through width functions", () => {
  assert.equal(displayWidth(FAMILY), 2)
  assert.equal(displayWidth(FLAG), 2)
  assert.equal(displayWidth("\u0031\uFE0F\u20E3"), 2)
  assert.equal(truncate(FAMILY.repeat(4), 5), FAMILY.repeat(2) + "…")
  assert.deepEqual(wrapText(FLAG.repeat(5), 4), [FLAG.repeat(2), FLAG.repeat(2), FLAG])
  const wrapped = wrapText((FAMILY + "x").repeat(3), 3)
  for (const line of wrapped) assert.ok(displayWidth(line) <= 3, line)
})

test("wrapText wraps on words and hard-breaks long tokens", () => {
  const lines = wrapText("the quick brown fox jumps over the lazy dog", 12)
  assert.ok(lines.length > 1)
  for (const line of lines) assert.ok(displayWidth(line) <= 12, line)
  const long = wrapText("a".repeat(30), 10)
  assert.deepEqual(long.map((line) => line.length), [10, 10, 10])
})

test("bar renders partial eighth blocks", () => {
  assert.equal(bar(1, 8), "█".repeat(8))
  assert.equal(bar(0, 8), " ".repeat(8))
  const half = bar(0.5, 8)
  assert.ok(half.startsWith("████"))
  assert.ok(displayWidth(half) <= 9)
})

test("frame closes all sides", () => {
  const lines = frame({ lines: ["hello", "world!!"], width: 24, title: "t", icon: "✦" })
  assert.ok(lines[0]!.startsWith("╭"))
  assert.ok(lines[0]!.endsWith("╮"))
  assert.ok(lines[lines.length - 1]!.startsWith("╰"))
  for (const line of lines) assert.equal(displayWidth(line), 24, line)
})

test("padCenter and joinColumns align blocks", () => {
  assert.equal(padCenter("x", 5), "  x  ")
  const joined = joinColumns([["ab", "cd"], ["W"]])
  assert.deepEqual(joined, ["ab W", "cd"])
})

test("raster line draws a continuous diagonal", () => {
  const raster = new Raster(10, 5)
  raster.line(0, 0, 19, 9)
  const lines = raster.toLines()
  assert.equal(lines.length, 5)
  assert.ok(lines.some((line) => line.trim().length > 0))
})

test("charts render for every kind within width", () => {
  const cases: Element[] = [
    { type: "chart", chart: "bar", data: [{ label: "a", value: 3 }, { label: "b", value: 7 }] },
    { type: "chart", chart: "column", values: [3, 7, 2, 9], labels: ["a", "b", "c", "d"] },
    { type: "chart", chart: "line", values: [1, 5, 3, 8, 6, 9] },
    { type: "chart", chart: "area", values: [1, 5, 3, 8, 6, 9] },
    { type: "chart", chart: "scatter", values: [1, 5, 3, 8, 6, 9] },
    { type: "chart", chart: "donut", data: [{ label: "x", value: 3 }, { label: "y", value: 5 }, { label: "z", value: 2 }] },
    { type: "chart", chart: "histogram", values: [1, 2, 2, 3, 4, 5, 5, 5, 6, 7, 9] },
    { type: "chart", chart: "sparkline", values: [1, 2, 1, 3, 5, 4, 8] },
    { type: "chart", chart: "heatmap", rows: [{ label: "r1", values: [1, 5, 3] }, { label: "r2", values: [4, 2, 6] }] },
  ]
  for (const element of cases) {
    const lines = renderElement(element, { width: WIDTH })
    assert.ok(lines.length > 1, element.type)
    for (const line of lines) assert.ok(displayWidth(line) <= WIDTH, `${JSON.stringify(line)} exceeds width`)
  }
})

test("donut without positive values throws", () => {
  assert.throws(() => renderElement({ type: "chart", chart: "donut", values: [0, 0] }, { width: WIDTH }), /positive/)
})

test("quartiles use linear interpolation", () => {
  const { q1, median, q3 } = quartiles([9, 1, 5, 3, 7, 2, 8, 4, 6])
  assert.equal(q1, 3)
  assert.equal(median, 5)
  assert.equal(q3, 7)
})

test("box plot marks tukey outliers but not in minmax mode", () => {
  const base = { type: "chart", chart: "box", series: [{ name: "s", values: [1, 2, 3, 4, 5, 100] }] } as Element
  assert.ok(renderElement(base, { width: WIDTH }).join("\n").includes("×"))
  const minmax = renderElement({ ...base, whiskers: "minmax" } as Element, { width: WIDTH }).join("\n")
  assert.ok(!minmax.includes("×"))
})

test("stacked percent column fills the full height", () => {
  const lines = renderElement(
    { type: "chart", chart: "column", stacked: true, percent: true, data: [{ value: 10 }] },
    { width: 40 },
  )
  const rasterLine = lines[2]!
  assert.ok(rasterLine.length > 5)
  assert.ok(!rasterLine.includes(" "), JSON.stringify(rasterLine))
})

test("grouped columns list every series in the legend", () => {
  const text = renderElement(
    {
      type: "chart",
      chart: "column",
      grouped: true,
      labels: ["a", "b"],
      series: [
        { name: "cold", values: [1, 2] },
        { name: "warm", values: [2, 1] },
      ],
    },
    { width: WIDTH },
  ).join("\n")
  assert.ok(text.includes("██ cold"))
  assert.ok(text.includes("▓▓ warm"))
})

test("stacked columns reject negative values", () => {
  assert.throws(
    () => renderElement({ type: "chart", chart: "column", stacked: true, series: [{ values: [1, -1] }] }, { width: WIDTH }),
    /non-negative/,
  )
})

test("gauge shows value, bounds and over-max note", () => {
  const text = renderElement({ type: "chart", chart: "gauge", value: 73, max: 100 }, { width: WIDTH }).join("\n")
  assert.ok(text.includes("73"))
  assert.ok(text.includes("100"))
  const over = renderElement({ type: "chart", chart: "gauge", value: 120, max: 100 }, { width: WIDTH }).join("\n")
  assert.ok(over.includes("▲"))
})

test("bullet marks targets and prints value/reference", () => {
  const text = renderElement(
    { type: "chart", chart: "bullet", items: [{ label: "p50", value: 72, target: 80 }] },
    { width: WIDTH },
  ).join("\n")
  assert.ok(text.includes("╿"))
  assert.ok(text.includes("72/80"))
})

test("waterfall signs deltas and shows the running total", () => {
  const text = renderElement(
    {
      type: "chart",
      chart: "waterfall",
      data: [
        { label: "start", value: 10, type: "abs" },
        { label: "cut", value: -4 },
        { label: "add", value: 6 },
        { label: "end", type: "total", value: 0 },
      ],
    },
    { width: WIDTH },
  ).join("\n")
  assert.ok(text.includes("-4"))
  assert.ok(text.includes("+6"))
  assert.ok(text.includes("12"))
})

test("funnel prints stage counts and conversion percentages", () => {
  const text = renderElement(
    {
      type: "chart",
      chart: "funnel",
      data: [
        { label: "visits", value: 100 },
        { label: "signups", value: 81 },
        { label: "paid", value: 40 },
      ],
    },
    { width: WIDTH },
  ).join("\n")
  assert.ok(text.includes("(81%)"))
  assert.ok(text.includes("(49%)"))
})

test("calendar bins days in UTC and marks zero cells", () => {
  const data = Array.from({ length: 7 }, (_, index) => ({
    label: `2026-10-${String(12 + index).padStart(2, "0")}`,
    value: index === 0 ? 0 : index * 2,
  }))
  const text = renderElement({ type: "chart", chart: "calendar", data }, { width: WIDTH }).join("\n")
  assert.ok(text.includes("Oct"))
  assert.ok(text.includes("Mon"))
  assert.ok(text.includes("Sun"))
  assert.ok(text.includes("·"))
})

test("calendar rejects labels that are not dates", () => {
  assert.throws(
    () => renderElement({ type: "chart", chart: "calendar", data: [{ label: "week 1", value: 3 }] }, { width: WIDTH }),
    /YYYY-MM-DD/,
  )
})

test("new chart kinds stay within every common width", () => {
  const cases: Element[] = [
    {
      type: "chart",
      chart: "column",
      stacked: true,
      percent: true,
      labels: ["a", "b", "c"],
      series: [
        { name: "x", values: [1, 2, 3] },
        { name: "y", values: [3, 2, 1] },
      ],
    },
    {
      type: "chart",
      chart: "column",
      grouped: true,
      labels: ["a", "b", "c"],
      series: [
        { name: "x", values: [1, 2, 3] },
        { name: "y", values: [3, 2, 1] },
      ],
    },
    {
      type: "chart",
      chart: "box",
      series: [
        { name: "x", values: [1, 2, 3, 40] },
        { name: "y", values: [5, 6, 7] },
      ],
    },
    { type: "chart", chart: "gauge", value: 55, max: 100, bands: [{ upTo: 50 }, { upTo: 80 }, { upTo: 100 }] },
    { type: "chart", chart: "bullet", items: [{ label: "a", value: 4, target: 5, max: 8 }], bands: [{ upTo: 0.5 }] },
    {
      type: "chart",
      chart: "waterfall",
      data: [
        { label: "a", value: 5, type: "abs" },
        { label: "b", value: -2 },
        { label: "c", value: 1 },
        { label: "d", type: "total", value: 0 },
      ],
    },
    {
      type: "chart",
      chart: "funnel",
      data: [
        { label: "a", value: 9 },
        { label: "b", value: 5 },
        { label: "c", value: 2 },
      ],
    },
    {
      type: "chart",
      chart: "calendar",
      data: Array.from({ length: 20 }, (_, index) => ({
        label: `2026-09-${String(index + 1).padStart(2, "0")}`,
        value: index,
      })),
    },
  ]
  for (const width of [40, 56, 72, 100]) {
    for (const element of cases) {
      const lines = renderElement(element, { width })
      for (const line of lines) {
        assert.ok(displayWidth(line) <= width, `width ${width} ${JSON.stringify(line)}`)
      }
    }
  }
})

test("widgets render", () => {
  const elements: Element[] = [
    { type: "stats", items: [{ label: "Build", value: 12.5, unit: "s", delta: "-1.2s", trend: "down" }, { label: "Errors", value: 0 }] },
    { type: "table", columns: ["name", "count"], rows: [["a", 1], ["b", 2]], align: ["l", "r"] },
    { type: "checklist", title: "Plan", items: [{ label: "step", status: "done" }, { label: "next", status: "doing" }] },
    { type: "callout", level: "warning", body: "careful with this thing" },
    { type: "tree", nodes: [{ label: "root", children: [{ label: "leaf", note: "1" }] }] },
    { type: "suggest", items: [{ label: "Go", prompt: "do the thing" }] },
    { type: "divider", label: "end" },
  ]
  const lines = renderElements(elements, { width: WIDTH })
  assert.ok(lines.length > 10)
  for (const line of lines) assert.ok(displayWidth(line) <= WIDTH, line)
})

test("unknown element type reports index and type", () => {
  const bad = { type: "nope" } as unknown as Element
  assert.throws(() => renderElements([bad], { width: WIDTH }), /element 1 \(nope\)/)
})

test("empty elements list throws", () => {
  assert.throws(() => renderElements([], { width: WIDTH }), /no elements/)
})
