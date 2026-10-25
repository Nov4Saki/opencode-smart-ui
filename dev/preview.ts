import { renderElements, type Element } from "../src/render/elements.ts"

const width = Number(process.argv[2] ?? 72)

const calendarData = (() => {
  const out: { label: string; value: number }[] = []
  const start = Date.UTC(2026, 7, 24)
  for (let i = 0; i < 54; i++) {
    const date = new Date(start + i * 86400000)
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
    const wave = Math.round(6 + 5 * Math.sin(i / 4) + (weekend ? -3 : 2))
    out.push({ label: date.toISOString().slice(0, 10), value: Math.max(0, wave + (i % 3) - 1) })
  }
  return out
})()

const samples: { name: string; elements: Element[] }[] = [
  {
    name: "bar chart",
    elements: [
      {
        type: "chart",
        chart: "bar",
        title: "Bundle size by package (kB)",
        data: [
          { label: "react-dom", value: 130.2 },
          { label: "lodash", value: 71.4 },
          { label: "react", value: 6.4 },
          { label: "@opencode-ai/sdk", value: 212.8 },
          { label: "zod", value: 57.1 },
        ],
      },
    ],
  },
  {
    name: "column chart",
    elements: [
      {
        type: "chart",
        chart: "column",
        title: "Weekly installs",
        unit: "k",
        data: [
          { label: "w1", value: 12 },
          { label: "w2", value: 18 },
          { label: "w3", value: 15 },
          { label: "w4", value: 27 },
          { label: "w5", value: 31 },
          { label: "w6", value: 28 },
          { label: "w7", value: 42 },
          { label: "w8", value: 39 },
          { label: "w9", value: 51 },
          { label: "w10", value: 47 },
        ],
      },
    ],
  },
  {
    name: "line chart (multi-series)",
    elements: [
      {
        type: "chart",
        chart: "line",
        title: "Response time p50 vs p95 (ms)",
        series: [
          { name: "p50", values: [42, 45, 44, 47, 52, 49, 51, 55, 53, 58, 56, 61] },
          { name: "p95", values: [180, 190, 175, 210, 230, 205, 260, 240, 285, 260, 310, 295] },
        ],
      },
    ],
  },
  {
    name: "area chart",
    elements: [
      {
        type: "chart",
        chart: "area",
        title: "Traffic per day",
        unit: "k",
        values: [4, 6, 5, 9, 12, 10, 14, 18, 15, 19, 24, 21, 27, 30],
      },
    ],
  },
  {
    name: "scatter",
    elements: [
      {
        type: "chart",
        chart: "scatter",
        title: "File size vs load time",
        series: [
          { name: "modules", values: [2, 8, 5, 11, 7, 14, 9, 18, 12, 22, 16, 26] },
        ],
      },
    ],
  },
  {
    name: "donut",
    elements: [
      {
        type: "chart",
        chart: "donut",
        title: "Dependency weight",
        unit: "kB",
        data: [
          { label: "sdk", value: 212.8 },
          { label: "react-dom", value: 130.2 },
          { label: "lodash", value: 71.4 },
          { label: "zod", value: 57.1 },
          { label: "react", value: 6.4 },
        ],
      },
    ],
  },
  {
    name: "histogram",
    elements: [
      {
        type: "chart",
        chart: "histogram",
        title: "Build duration distribution",
        unit: "s",
        values: [12, 14, 15, 13, 16, 18, 14, 22, 25, 17, 13, 19, 21, 28, 31, 24, 16, 15, 33, 27, 20, 18, 41, 36],
        bins: 8,
      },
    ],
  },
  {
    name: "sparkline",
    elements: [
      {
        type: "chart",
        chart: "sparkline",
        title: "Weekly downloads (last 56 days)",
        series: [
          { name: "installs", values: [3, 4, 4, 6, 5, 7, 9, 8, 11, 10, 13, 12, 15, 17, 16, 19, 21, 20, 24, 26, 25, 28, 31, 30, 34, 33, 37, 39, 38, 42, 45, 44, 48, 51, 50, 54, 57, 56, 61, 64, 63, 68, 71, 70, 75, 78, 77, 82, 86, 85, 90, 94, 93, 98, 103, 107] },
        ],
      },
    ],
  },
  {
    name: "heatmap",
    elements: [
      {
        type: "chart",
        chart: "heatmap",
        title: "Commits per day, by team",
        rows: [
          { label: "core", values: [3, 5, 4, 8, 6, 2, 0, 4, 7, 9, 5, 3, 1, 0, 6] },
          { label: "tui", values: [1, 2, 6, 7, 3, 1, 0, 2, 5, 8, 4, 2, 0, 1, 3] },
          { label: "sdk", values: [0, 1, 2, 4, 5, 3, 1, 3, 6, 7, 6, 4, 2, 1, 2] },
          { label: "docs", values: [2, 0, 1, 3, 2, 0, 0, 1, 2, 4, 3, 1, 0, 0, 1] },
        ],
      },
    ],
  },
  {
    name: "stacked columns (percent)",
    elements: [
      {
        type: "chart",
        chart: "column",
        stacked: true,
        percent: true,
        title: "Traffic mix by quarter",
        labels: ["Q1", "Q2", "Q3", "Q4"],
        series: [
          { name: "organic", values: [42, 45, 47, 50] },
          { name: "paid", values: [31, 28, 26, 24] },
          { name: "referral", values: [18, 19, 20, 19] },
          { name: "direct", values: [9, 8, 7, 7] },
        ],
      },
    ],
  },
  {
    name: "grouped columns",
    elements: [
      {
        type: "chart",
        chart: "column",
        grouped: true,
        title: "Build time by branch (s)",
        labels: ["main", "feat/ui", "fix/api", "docs"],
        series: [
          { name: "cold cache", values: [42, 51, 38, 12] },
          { name: "warm cache", values: [18, 22, 16, 5] },
        ],
      },
    ],
  },
  {
    name: "box plot",
    elements: [
      {
        type: "chart",
        chart: "box",
        title: "API latency by endpoint",
        unit: "ms",
        series: [
          { name: "GET /users", values: [12, 14, 15, 15, 16, 17, 18, 19, 21, 22, 24, 28, 31, 96] },
          { name: "GET /orders", values: [22, 25, 26, 27, 28, 30, 31, 33, 35, 38, 42, 46, 52, 61, 128, 141] },
          { name: "POST /checkout", values: [85, 92, 95, 97, 99, 102, 104, 108, 112, 118, 125, 131, 143, 260] },
        ],
      },
    ],
  },
  {
    name: "gauge",
    elements: [
      {
        type: "chart",
        chart: "gauge",
        title: "CPU headroom",
        value: 73.4,
        max: 100,
        unit: "%",
        bands: [
          { upTo: 60, label: "healthy" },
          { upTo: 85, label: "warning" },
          { upTo: 100, label: "critical" },
        ],
      },
    ],
  },
  {
    name: "bullet",
    elements: [
      {
        type: "chart",
        chart: "bullet",
        title: "SLO status",
        bands: [{ upTo: 0.6 }, { upTo: 0.85 }],
        items: [
          { label: "p50 latency", value: 82, target: 100, max: 150 },
          { label: "error rate", value: 2.1, target: 1, max: 5 },
          { label: "queue depth", value: 38, target: 40, max: 60 },
          { label: "cache hit %", value: 91, target: 95, max: 100 },
        ],
      },
    ],
  },
  {
    name: "waterfall",
    elements: [
      {
        type: "chart",
        chart: "waterfall",
        title: "Revenue to profit (k$)",
        data: [
          { label: "revenue", value: 220, type: "abs" },
          { label: "cogs", value: -84 },
          { label: "ops", value: -36 },
          { label: "marketing", value: -18 },
          { label: "tax", value: -12 },
          { label: "profit", type: "total", value: 0 },
        ],
      },
    ],
  },
  {
    name: "funnel",
    elements: [
      {
        type: "chart",
        chart: "funnel",
        title: "Signup funnel",
        data: [
          { label: "visits", value: 24800 },
          { label: "signups", value: 6100 },
          { label: "activated", value: 3220 },
          { label: "trial", value: 1180 },
          { label: "paid", value: 264 },
        ],
      },
    ],
  },
  {
    name: "calendar heatmap",
    elements: [
      {
        type: "chart",
        chart: "calendar",
        title: "Commits per day",
        data: calendarData,
      },
    ],
  },
  {
    name: "diff",
    elements: [
      {
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
          '+  value: S.number(),',
          '+  type: S.enum(["abs", "delta", "total"]).optional(),',
          " })",
          "\\ No newline at end of file",
          "@@ -160,5 +165,11 @@ const DESCRIPTION = [",
          '-  "Charts: bar, column, line, area, scatter, donut, histogram.",',
          '+  "Charts: bar, column (stacked/grouped/percent), line, area, scatter, donut, histogram, sparkline, heatmap, box, gauge, bullet, waterfall, funnel, calendar, and a deliberately long closing sentence that has to wrap.",',
          " ]",
        ].join("\n"),
      },
    ],
  },
  {
    name: "kv",
    elements: [
      {
        type: "kv",
        title: "Run summary",
        items: [
          { label: "Model", value: "deepseek-v4.1-flash" },
          { label: "Input tokens", value: 48120 },
          { label: "Output tokens", value: 3912 },
          { label: "Cost", value: "$0.42" },
          { label: "Session", value: "ses_8f3k20" },
        ],
      },
    ],
  },
  {
    name: "badge",
    elements: [
      {
        type: "badge",
        title: "CI checks",
        items: [
          { name: "typecheck", tone: "ok" },
          { name: "tests", value: "42/42", tone: "ok" },
          { name: "lint", value: "4 warnings", tone: "warn" },
          { name: "coverage", value: "81%", tone: "info" },
          { name: "e2e", value: "skipped", tone: "bad" },
        ],
      },
    ],
  },
  {
    name: "stepper",
    elements: [
      {
        type: "stepper",
        title: "Deploy pipeline",
        steps: [
          { label: "build", status: "done" },
          { label: "test", status: "done" },
          { label: "migrate", status: "active" },
          { label: "deploy", status: "todo" },
          { label: "verify", status: "todo" },
        ],
      },
    ],
  },
  {
    name: "empty",
    elements: [
      {
        type: "empty",
        message: "No failing tests in the latest run",
        hint: "all 42 passed in 389 ms",
      },
    ],
  },
  {
    name: "quote",
    elements: [
      {
        type: "quote",
        text: "Design decisions age faster than code. Write them down while the reasoning is still fresh, or you will re-litigate them at every review.",
        attribution: "refactor retro",
      },
    ],
  },
  {
    name: "footnotes",
    elements: [
      {
        type: "footnotes",
        title: "Notes",
        items: [
          "Node 24 ships Intl.Segmenter, so grapheme-safe truncation needs no dependencies.",
          "Widths follow East-Asian-Width rules; ZWJ emoji sequences are one cluster once the hardening pass lands.",
          "All art is plain UTF-8 text inside a fenced code block.",
        ],
      },
    ],
  },
  {
    name: "stats",
    elements: [
      {
        type: "stats",
        title: "Build summary",
        items: [
          { label: "Bundle size", value: 482.6, unit: " kB", delta: "-12.3 kB", trend: "down", hint: "vs last build" },
          { label: "Type errors", value: 0, delta: "clean", trend: "flat" },
          { label: "Build time", value: 18.4, unit: "s", delta: "-2.1 s", trend: "down" },
          { label: "Tests", value: "128/128", delta: "all passing", trend: "flat" },
          { label: "Type coverage", value: 97, unit: "%", trend: "up", delta: "+1%" },
        ],
      },
    ],
  },
  {
    name: "table",
    elements: [
      {
        type: "table",
        title: "Dependencies to update",
        columns: ["Package", "Current", "Latest", "Risk"],
        rows: [
          ["typescript", "5.6.3", "5.9.2", "low"],
          ["zod", "4.1.8", "4.1.8", "none"],
          ["vite", "6.0.1", "7.1.4", 0.8],
          ["react", "19.0.0", "19.2.0", "low"],
        ],
        align: ["l", "r", "r", "c"],
      },
    ],
  },
  {
    name: "checklist",
    elements: [
      {
        type: "checklist",
        title: "Migration progress",
        items: [
          { label: "Audit existing imports", status: "done" },
          { label: "Add zod schemas", status: "done" },
          { label: "Rewrite tool registry", status: "doing", detail: "3 of 7 tools ported" },
          { label: "Update docs", status: "todo" },
          { label: "Remove legacy shims", status: "blocked", detail: "waiting on v2 SDK release" },
        ],
      },
    ],
  },
  {
    name: "callout",
    elements: [
      {
        type: "callout",
        level: "warning",
        title: "Breaking change",
        body: "Plugin API v2 renames the tool execute context. Pin @opencode-ai/plugin to 1.14.46 until the v2 migration guide lands.",
      },
    ],
  },
  {
    name: "tree",
    elements: [
      {
        type: "tree",
        title: "Project structure",
        nodes: [
          {
            label: "src/",
            note: "root",
            children: [
              { label: "index.ts", note: "entry" },
              {
                label: "render/",
                children: [
                  { label: "chart.ts", note: "212 lines" },
                  { label: "widgets.ts", note: "198 lines" },
                  { label: "util.ts", note: "94 lines" },
                ],
              },
              { label: "tools/", note: "3 tools" },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "suggest",
    elements: [
      {
        type: "suggest",
        title: "Where to go next",
        items: [
          { label: "Run the test suite", prompt: "Run the full test suite and summarize failures", description: "quick health check" },
          { label: "Upgrade vite to v7", prompt: "Plan the vite 7 upgrade and list breaking changes that affect this repo", description: "dep maintenance" },
          { label: "Write the migration guide", prompt: "Draft a v1-to-v2 plugin migration guide based on our notes" },
        ],
      },
    ],
  },
  {
    name: "divider",
    elements: [
      { type: "divider" },
      { type: "divider", label: "next section" },
    ],
  },
  {
    name: "study session summary",
    elements: [
      {
        type: "stats",
        title: "Warm-up — summary",
        items: [
          { label: "Score", value: "4/5" },
          { label: "Accuracy", value: "80%" },
          { label: "Missed", value: 1 },
        ],
      },
      {
        type: "checklist",
        title: "Question review",
        items: [
          { label: "Q1 · What does the TUI appendPrompt call do?", status: "done" },
          { label: "Q2 · When must the model echo the fenced block?", status: "done" },
          { label: "Q3 · Which element renders dot leaders?", status: "blocked" },
          { label: "Q4 · What width invariant does renderElement enforce?", status: "done" },
          { label: "Q5 · Which hook injects pending UI state?", status: "done" },
        ],
      },
    ],
  },
  {
    name: "flashcard reveal",
    elements: [
      {
        type: "quote",
        text: "Node 24 ships Intl.Segmenter, so grapheme-safe truncation needs no dependencies.",
        attribution: "deck · card 2/5 — answer",
      },
    ],
  },
]

for (const sample of samples) {
  console.log(`\n=== ${sample.name} ${"=".repeat(Math.max(2, width - sample.name.length - 6))}`)
  try {
    const lines = renderElements(sample.elements, { width, prefillIndex: sample.name === "suggest" ? 2 : undefined })
    console.log(lines.join("\n"))
  } catch (error) {
    console.error("FAILED:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
