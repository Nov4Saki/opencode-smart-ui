import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { test } from "node:test"
import { renderElement, type Element } from "../src/render/elements.ts"
import { parsePatch, superscript } from "../src/render/text.ts"
import { displayWidth } from "../src/render/util.ts"

const WIDTH = 72

const renamePatch = [
  "diff --git a/src/old.ts b/src/new.ts",
  "similarity index 100%",
  "rename from src/old.ts",
  "rename to src/new.ts",
].join("\n")

test("diff parser keeps rename metadata without hunks", () => {
  const sections = parsePatch(renamePatch)
  assert.equal(sections.length, 1)
  assert.equal(sections[0]!.path, "src/new.ts")
  assert.equal(sections[0]!.hunks.length, 0)
  assert.ok(sections[0]!.meta.some((line) => line.startsWith("rename from")))
  const text = renderElement({ type: "diff", patch: renamePatch }, { width: WIDTH }).join("\n")
  assert.ok(text.includes("── src/new.ts"))
  assert.ok(text.includes("rename to src/new.ts"))
})

test("diff no-newline marker renders as a note", () => {
  const patch = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,1 +1,2 @@", " keep", "+added", "\\ No newline at end of file"].join("\n")
  const sections = parsePatch(patch)
  assert.equal(sections[0]!.hunks[0]!.lines.at(-1)!.type, "marker")
  const text = renderElement({ type: "diff", patch }, { width: WIDTH }).join("\n")
  assert.ok(text.includes("⊘ no newline at end of file"))
  assert.ok(text.includes("+ added"))
})

test("diff parser reports malformed hunk headers with the line number", () => {
  const patch = ["--- a/x.ts", "+++ b/x.ts", "@@ -x,1 +1,1 @@"].join("\n")
  assert.throws(() => parsePatch(patch), /patch line 3/)
})

test("diff validates input combinations and structured headers", () => {
  assert.throws(
    () => renderElement({ type: "diff", hunks: [{ header: "nope", lines: [] }] }, { width: WIDTH }),
    /@@ -12,4 \+12,6 @@/,
  )
  assert.throws(() => renderElement({ type: "diff", patch: renamePatch, hunks: [] }, { width: WIDTH }), /not both/)
  assert.throws(() => renderElement({ type: "diff" }, { width: WIDTH }), /needs `patch`/)
})

test("diff numbers lines, shows whitespace and wraps long content", () => {
  const element: Element = {
    type: "diff",
    path: "src/app.ts",
    showWhitespace: true,
    hunks: [
      {
        header: "@@ -7,3 +7,4 @@",
        lines: [
          { type: "ctx", text: "const a = 1" },
          { type: "del", text: "const b = 2" },
          { type: "add", text: "const b = 3 " + "x".repeat(120) },
        ],
      },
    ],
  }
  const lines = renderElement(element, { width: WIDTH })
  const text = lines.join("\n")
  assert.ok(text.includes(" 7  7   const·a·=·1"))
  assert.ok(text.includes(" 8    - const·b·=·2"))
  assert.ok(text.includes("   8 + const·b·=·3"))
  assert.ok(text.includes("      ↩ "))
  for (const line of lines) assert.ok(displayWidth(line) <= WIDTH)
  assert.ok(!text.includes("…"), "wrapped diff lines must not need truncation")
})

test("kv renders dot leaders with right-aligned values", () => {
  const lines = renderElement(
    {
      type: "kv",
      items: [
        { label: "Model", value: "abc" },
        { label: "Long label here", value: 48120 },
      ],
    },
    { width: 40 },
  )
  assert.match(lines[0]!, /^Model +\.{2,} abc$/)
  assert.ok(lines[1]!.includes("48,120"))
  assert.equal(displayWidth(lines[0]!), 40)
  assert.equal(displayWidth(lines[1]!), 40)
})

test("badge wraps chips to at most two lines", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ name: `check-${index}`, value: index, tone: "info" as const }))
  const lines = renderElement({ type: "badge", items }, { width: 40 })
  assert.ok(lines.length <= 2, lines.join("\n"))
  assert.ok(lines.join("\n").includes("…"))
  for (const line of lines) assert.ok(displayWidth(line) <= 40, line)
})

test("stepper renders inline statuses and falls back vertically", () => {
  const inline = renderElement(
    {
      type: "stepper",
      steps: [
        { label: "a", status: "done" },
        { label: "b", status: "active" },
        { label: "c" },
      ],
    },
    { width: WIDTH },
  ).join("\n")
  assert.ok(inline.includes("✔ a ─ ● b ─ ○ c"))
  const vertical = renderElement(
    { type: "stepper", steps: Array.from({ length: 6 }, (_, index) => ({ label: `a-very-long-step-name-${index}` })) },
    { width: 40 },
  )
  assert.equal(vertical.length, 6)
  assert.ok(vertical[0]!.startsWith("①"))
})

test("empty renders a one-line empty state", () => {
  const lines = renderElement({ type: "empty", message: "No results", hint: "widen the filter" }, { width: WIDTH })
  assert.equal(lines.length, 1)
  assert.ok(lines[0]!.startsWith("∅ No results"))
  assert.ok(lines[0]!.includes("— widen the filter"))
})

test("quote prefixes every line and renders attribution", () => {
  const lines = renderElement({ type: "quote", text: "line one\nline two stays short", attribution: "someone" }, { width: 30 })
  for (const line of lines) assert.ok(line.startsWith("│ "))
  assert.ok(lines.at(-1)!.includes("— someone"))
})

test("footnotes use superscript markers and hanging indent", () => {
  const lines = renderElement(
    {
      type: "footnotes",
      items: ["first", "second with a much longer body that must wrap onto a hanging indent line for sure"],
    },
    { width: 40 },
  )
  assert.ok(lines[0]!.startsWith("¹ first"))
  assert.ok(lines.some((line) => line.startsWith("² ")))
  assert.ok(lines.some((line) => line.startsWith("  ") && line.trim() !== ""))
  assert.equal(superscript(12), "¹²")
})

test("text elements stay within every common width", () => {
  const longLine = "y".repeat(300)
  const cases: Element[] = [
    {
      type: "diff",
      hunks: [
        {
          header: "@@ -1,2 +1,3 @@",
          lines: [
            { type: "ctx", text: longLine },
            { type: "add", text: longLine },
            { type: "del", text: "short" },
          ],
        },
      ],
    },
    { type: "kv", items: [{ label: "A very long label that should be truncated somewhere sensible", value: longLine }] },
    { type: "badge", items: Array.from({ length: 9 }, (_, index) => ({ name: `badge-${index}`, value: longLine, tone: "warn" })) },
    { type: "stepper", steps: Array.from({ length: 9 }, (_, index) => ({ label: `step-${index}-${longLine}` })) },
    { type: "empty", message: longLine },
    { type: "quote", text: longLine, attribution: longLine },
    { type: "footnotes", items: [longLine, longLine] },
  ]
  for (const width of [40, 56, 72, 100]) {
    for (const element of cases) {
      const lines = renderElement(element, { width })
      assert.ok(lines.length > 0, JSON.stringify(element.type))
      for (const line of lines) {
        assert.ok(displayWidth(line) <= width, `width ${width} ${JSON.stringify(line)}`)
      }
    }
  }
})

const goldenFixtures: { name: string; element: Element }[] = [
  {
    name: "diff",
    element: {
      type: "diff",
      title: "Working tree changes",
      patch: [
        "diff --git a/src/tools/render.ts b/src/tools/render.ts",
        "index 91c3e02..f4b1107 100644",
        "--- a/src/tools/render.ts",
        "+++ b/src/tools/render.ts",
        "@@ -18,3 +18,6 @@ const pointSchema = S.object({",
        "   label: S.string().optional(),",
        "-  value: S.number(),",
        "+  value: S.number(),",
        '+  type: S.enum(["abs", "delta", "total"]).optional(),',
        " })",
        "\\ No newline at end of file",
      ].join("\n"),
    },
  },
  {
    name: "kv",
    element: {
      type: "kv",
      title: "Run summary",
      items: [
        { label: "Model", value: "deepseek-v4.1-flash" },
        { label: "Input tokens", value: 48120 },
        { label: "Output tokens", value: 3912 },
        { label: "Cost", value: "$0.42" },
      ],
    },
  },
  {
    name: "badge",
    element: {
      type: "badge",
      title: "CI checks",
      items: [
        { name: "typecheck", tone: "ok" },
        { name: "tests", value: "42/42", tone: "ok" },
        { name: "lint", value: "4 warnings", tone: "warn" },
      ],
    },
  },
  {
    name: "stepper",
    element: {
      type: "stepper",
      title: "Deploy pipeline",
      steps: [
        { label: "build", status: "done" },
        { label: "test", status: "done" },
        { label: "migrate", status: "active" },
        { label: "deploy", status: "todo" },
      ],
    },
  },
  { name: "empty", element: { type: "empty", message: "No failing tests in the latest run", hint: "all 42 passed" } },
  {
    name: "quote",
    element: { type: "quote", text: "Design decisions age faster than code.", attribution: "refactor retro" },
  },
  { name: "footnotes", element: { type: "footnotes", title: "Notes", items: ["First note.", "Second note."] } },
]

function renderGolden(): string {
  return goldenFixtures.map((fixture) => `### ${fixture.name}\n` + renderElement(fixture.element, { width: 72 }).join("\n")).join("\n\n") + "\n"
}

test("M2 text elements match the golden file", () => {
  const goldenUrl = new URL("./golden/text-72.txt", import.meta.url)
  const rendered = renderGolden()
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(new URL("./golden/", import.meta.url), { recursive: true })
    writeFileSync(goldenUrl, rendered)
  }
  assert.equal(rendered, readFileSync(goldenUrl, "utf8"))
})

const ASCII = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join("")
const ALLOWED = new Set(
  [
    ASCII,
    "░▒▓█",
    "▁▂▃▄▅▆▇",
    "▏▎▍▌▋▊▉",
    "▗▖▝▐▞▟▘▚▙▀▜▛",
    "─│┌┐└┘├┤┬┴┼╭╮╰╯",
    "…·—–▲▼△▽",
    "→←↑↓↳↩═╌┈┆╿",
    "✔✖⚠ℹ✦▸●○◉⊘∅×≤",
    "≤≥≠±≈×÷−",
    "①②③④⑤⑥⑦⑧⑨⑩⑪⑫",
    "⁰¹²³⁴⁵⁶⁷⁸⁹",
  ].join(""),
)

test("every glyph rendered by the corpus is on the allowlist", () => {
  const corpus: Element[] = [
    { type: "chart", chart: "bar", data: [{ label: "a", value: 3 }, { label: "b", value: 7 }] },
    { type: "chart", chart: "column", values: [3, 7, 2, 9], labels: ["a", "b", "c", "d"] },
    { type: "chart", chart: "column", stacked: true, percent: true, labels: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [2, 1] }] },
    { type: "chart", chart: "column", grouped: true, labels: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [2, 1] }] },
    { type: "chart", chart: "line", series: [{ name: "p50", values: [1, 5, 3, 8] }, { name: "p95", values: [2, 6, 4, 9] }] },
    { type: "chart", chart: "area", values: [1, 5, 3, 8, 6, 9] },
    { type: "chart", chart: "scatter", values: [1, 5, 3, 8, 6, 9] },
    { type: "chart", chart: "donut", data: [{ label: "x", value: 3 }, { label: "y", value: 5 }, { label: "z", value: 2 }] },
    { type: "chart", chart: "histogram", values: [1, 2, 2, 3, 4, 5, 5, 5, 6, 7, 9] },
    { type: "chart", chart: "sparkline", values: [1, 2, 1, 3, 5, 4, 8] },
    { type: "chart", chart: "heatmap", rows: [{ label: "r1", values: [1, 5, 3] }, { label: "r2", values: [4, 2, 6] }] },
    { type: "chart", chart: "box", series: [{ name: "s", values: [1, 2, 3, 4, 5, 100] }] },
    { type: "chart", chart: "gauge", value: 73, max: 100, bands: [{ upTo: 60 }, { upTo: 100 }] },
    { type: "chart", chart: "bullet", items: [{ label: "a", value: 4, target: 5, max: 8 }], bands: [{ upTo: 0.5 }] },
    { type: "chart", chart: "waterfall", data: [{ label: "a", value: 5, type: "abs" }, { label: "b", value: -2 }, { label: "c", value: 1 }, { label: "d", type: "total", value: 0 }] },
    { type: "chart", chart: "funnel", data: [{ label: "a", value: 9 }, { label: "b", value: 5 }] },
    { type: "chart", chart: "calendar", data: [{ label: "2026-10-12", value: 0 }, { label: "2026-10-13", value: 4 }] },
    { type: "stats", items: [{ label: "Build", value: 12.5, unit: "s", delta: "-1.2s", trend: "down" }] },
    { type: "table", columns: ["name", "count"], rows: [["a", 1]], align: ["l", "r"] },
    { type: "checklist", title: "Plan", items: [{ label: "step", status: "done" }, { label: "next", status: "blocked" }] },
    { type: "callout", level: "warning", body: "careful" },
    { type: "tree", nodes: [{ label: "root", children: [{ label: "leaf", note: "1" }] }] },
    { type: "suggest", items: [{ label: "Go", prompt: "do the thing" }] },
    { type: "divider", label: "end" },
    ...goldenFixtures.map((fixture) => fixture.element),
  ]
  const offenders = new Map<string, string>()
  for (const element of corpus) {
    const text = renderElement(element, { width: 72 }).join("\n")
    for (const ch of text) {
      if (ch === "\n") continue
      if (!ALLOWED.has(ch)) offenders.set(ch, JSON.stringify(element.type))
    }
  }
  assert.deepEqual([...offenders.entries()], [])
})
