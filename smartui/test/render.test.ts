import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  barChart,
  columnChart,
  donutChart,
  funnelChart,
  gaugeChart,
  heatmapChart,
  lineChart,
  progressChart,
  radarChart,
  scatterChart,
  sparklineChart,
  timelineChart,
  treemapChart,
  waterfallChart,
} from "../src/svg/charts.ts"
import { safeAlt, urlPayload } from "../src/svg/payload.ts"
import { calloutMarkdown, checklistMarkdown, kvMarkdown, quoteMarkdown, statsMarkdown, tableMarkdown } from "../src/svg/panels.ts"
import {
  barArt,
  columnArt,
  donutArt,
  funnelArt,
  gaugeArt,
  heatmapArt,
  progressArt,
  radarArt,
  scatterArt,
  sparklineArt,
  timelineArt,
  treemapArt,
  waterfallArt,
} from "../src/art/fallback.ts"
import { renderShowBlock } from "../src/show-core.ts"

test("column chart renders svg with escaped labels", () => {
  const svg = columnChart(["<Q1>", "Q2"], [{ name: "Rev", values: [120, 150] }])
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.ok(svg.trimEnd().endsWith("</svg>"))
  assert.ok(svg.includes("&lt;Q1&gt;"))
  assert.ok(!svg.includes("<Q1>"))
})

test("all chart types produce an svg document", () => {
  for (const svg of [
    barChart([{ label: "a", value: 1 }, { label: "b", value: 2 }]),
    columnChart(["a", "b"], [{ values: [1, 2] }], { stacked: true }),
    columnChart(["a", "b"], [{ name: "s1", values: [1, 2] }, { name: "s2", values: [2, 1] }], { percent: true }),
    lineChart(["a", "b", "c"], [{ values: [-5, 0, 5] }]),
    lineChart(["a", "b"], [{ values: [1, 2] }], { area: true }),
    donutChart([{ label: "x", value: 3 }, { label: "y", value: 1 }]),
    gaugeChart(62, { max: 100, bands: [{ upTo: 50, label: "low" }] }),
    sparklineChart([1, 3, 2, 8, 5]),
    scatterChart([{ name: "pts", points: [[1, 2], [3, 5], [4, 1]] }]),
    waterfallChart([{ label: "start", value: 40 }, { label: "add", value: 25 }, { label: "drop", value: -15 }]),
    heatmapChart([[1, 2, 3], [4, 5, 6]], { rowLabels: ["a", "b"], columnLabels: ["x", "y", "z"] }),
    radarChart(["speed", "power", "range", "cost", "size"], [{ name: "a", values: [3, 5, 2, 4, 1] }]),
    timelineChart([{ label: "design", start: 0, end: 4 }, { label: "build", start: 3, end: 9 }]),
    funnelChart([{ label: "visits", value: 1000 }, { label: "leads", value: 320 }, { label: "sales", value: 48 }]),
    progressChart(72, { max: 100, bands: [{ upTo: 50, label: "half" }] }),
    treemapChart([{ label: "core", value: 50 }, { label: "api", value: 30 }, { label: "docs", value: 12 }]),
  ]) {
    assert.ok(svg.includes("<svg"), "svg root present")
    assert.ok(svg.includes("</svg>"), "svg closed")
  }
})

test("empty data degrades to a no-data svg", () => {
  assert.ok(barChart([]).includes("no data"))
  assert.ok(columnChart([], []).includes("no data"))
  assert.ok(donutChart([]).includes("no data"))
  assert.ok(sparklineChart([]).includes("no data"))
  assert.ok(scatterChart([]).includes("no data"))
  assert.ok(waterfallChart([]).includes("no data"))
  assert.ok(heatmapChart([]).includes("no data"))
  assert.ok(radarChart(["a", "b", "c"], []).includes("no data"))
  assert.ok(timelineChart([]).includes("no data"))
  assert.ok(funnelChart([]).includes("no data"))
  assert.ok(treemapChart([]).includes("no data"))
})

test("image payload embeds the chart server url", () => {
  assert.equal(
    urlPayload("Goal progress", "http://127.0.0.1:5000/c/tok/abc12345.svg"),
    "![Goal progress](http://127.0.0.1:5000/c/tok/abc12345.svg)",
  )
})

test("safeAlt strips markdown-breaking characters", () => {
  assert.equal(safeAlt("a [b] (c)"), "a b c")
  assert.equal(safeAlt("   "), "chart")
})

test("panels render markdown", () => {
  const stats = statsMarkdown([{ label: "Revenue", value: "1.2M", unit: "$", delta: "+12%", trend: "up" }], "Sales")
  assert.ok(stats.includes("| Metric | Value | Change |"))
  assert.ok(stats.includes("▲"))
  const kv = kvMarkdown([{ label: "a", value: 1 }])
  assert.ok(kv.includes("| **a** | 1 |"))
  const checklist = checklistMarkdown(
    [
      { label: "done thing", status: "done" },
      { label: "current", status: "doing" },
    ],
    "Plan",
    50,
  )
  assert.ok(checklist.includes("**Progress: 50%**"))
  assert.ok(checklist.includes("- [x] **done thing**"))
  assert.ok(checklist.includes("(in progress)"))
  const callout = calloutMarkdown("warning", "careful\nsecond line", "Wait")
  assert.equal(callout.split("\n")[0], "> **Wait** — careful")
  assert.ok(callout.includes("\n> second line"))
  const table = tableMarkdown(["n", "v"], [["a|b", 2]], ["l", "r"])
  assert.ok(table.includes("a\\|b"))
  assert.ok(table.includes("---:"))
  const quote = quoteMarkdown("hello", "someone")
  assert.ok(quote.includes("> — someone"))
})

test("art fallbacks are compact and readable", () => {
  const bar = barArt([{ label: "alpha", value: 10 }, { label: "beta", value: 5 }])
  assert.equal(bar.length, 2)
  assert.ok(bar[0]!.includes("█"))
  assert.ok(bar[0]!.includes("10"))
  const gauge = gaugeArt(75)
  assert.ok(gauge[0]!.includes("75%"))
  assert.ok(gauge[0]!.includes("█"))
  const spark = sparklineArt([1, 2, 3, 4])
  assert.equal(spark.length, 1)
  assert.ok(spark[0]!.includes("min 1"))
  const columns = columnArt(["a", "b"], [{ values: [1, 2] }])
  assert.ok(columns.length >= 9)
  const donut = donutArt([{ label: "only", value: 5 }])
  assert.ok(donut[0]!.includes("100%"))
})

test("new art fallbacks stay compact and readable", () => {
  const scatter = scatterArt([{ points: [[1, 2], [3, 4]] }])
  assert.ok(scatter.length > 2)
  assert.ok(scatter.join("\n").includes("●"))
  const waterfall = waterfallArt([{ label: "start", value: 10 }, { label: "add", value: 5 }])
  assert.ok(waterfall[0]!.includes("+10"))
  assert.ok(waterfall[waterfall.length - 1]!.includes("total"))
  const heat = heatmapArt([[1, 5], [3, 0]], { rowLabels: ["a", "b"], columnLabels: ["x", "y"] })
  assert.ok(heat.length >= 3)
  assert.ok(heat.join("").includes("█"))
  const radar = radarArt(["speed", "power"], [{ values: [5, 1] }])
  assert.equal(radar.length, 2)
  assert.ok(radar[0]!.includes("█"))
  const timeline = timelineArt([{ label: "a", start: 0, end: 5 }])
  assert.ok(timeline[0]!.includes("▄"))
  const funnel = funnelArt([{ label: "top", value: 100 }, { label: "mid", value: 50 }])
  assert.ok(funnel[1]!.includes("50%"))
  const progress = progressArt(30, { max: 100 })
  assert.ok(progress[0]!.includes("30%"))
  assert.ok(progress[0]!.includes("█"))
  const treemap = treemapArt([{ label: "big", value: 75 }, { label: "small", value: 25 }])
  assert.equal(treemap.length, 2)
  assert.ok(treemap[0]!.includes("75%"))
})

test("scatter honours an alpha override and clamps it", () => {
  assert.ok(scatterChart([{ points: [[1, 2], [3, 4]] }], { alpha: 0.1 }).includes('fill-opacity="0.1"'))
  assert.ok(scatterChart([{ points: [[1, 2]] }], { alpha: 0 }).includes('fill-opacity="0.02"'))
  assert.ok(scatterChart([{ points: [[1, 2]] }], { alpha: 5 }).includes('fill-opacity="1"'))
  assert.ok(scatterChart([{ points: [[1, 2]] }], { alpha: Number.NaN }).includes('fill-opacity="0.85"'))
  assert.ok(scatterChart([{ points: [[1, 2]] }]).includes('fill-opacity="0.85"'))
})

test("scatter accepts note and radius options", () => {
  const svg = scatterChart([{ points: [[1, 2]] }], { note: "12.5k of 25k points", radius: 2 })
  assert.ok(svg.includes("12.5k of 25k points"))
  assert.ok(svg.includes('r="2"'))
  assert.ok(svg.includes('fill-opacity="0.85"'))
})

test("a big scatter source is sampled to vector dots with a count note", async () => {
  const root = mkdtempSync(join(tmpdir(), "smartui-scatter-"))
  try {
    const rows: string[] = ["x,y"]
    for (let i = 0; i < 25_000; i++) rows.push(`${(i * 37) % 997},${Math.sin(i * 0.13) * 100}`)
    writeFileSync(join(root, "cloud.csv"), rows.join("\n"))
    let captured = ""
    const out = await renderShowBlock(
      { element: "scatter", source: "cloud.csv", x: "x", y: "y", title: "Cloud" },
      {
        surface: "image",
        baseDirs: [root],
        charts: {
          publish: async (_key: string, svg: string) => {
            captured = svg
            return "http://127.0.0.1:1/c/tok/abc12345.svg"
          },
          formUrl: async () => undefined,
          close: async () => undefined,
        },
      },
    )
    assert.equal(out, "![Cloud](http://127.0.0.1:1/c/tok/abc12345.svg)")
    assert.ok(!captured.includes("<image"))
    const circles = captured.match(/<circle /g) ?? []
    assert.ok(circles.length > 0 && circles.length < 25_000)
    assert.ok(captured.includes("of 25k points"))
    assert.ok(captured.includes('r="2"'))
    assert.ok(captured.includes('fill-opacity="0.4"'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
