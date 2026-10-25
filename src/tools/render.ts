import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import type { z } from "zod"
import type { Element, SuggestElement } from "../render/elements.ts"
import { renderElements } from "../render/elements.ts"
import { clamp } from "../render/util.ts"
import type { PartBridge } from "../parts.ts"
import { newUiId } from "../state.ts"

const S = tool.schema

const pointSchema = S.object({
  label: S.string().optional(),
  value: S.number(),
  type: S.enum(["abs", "delta", "total"]).optional(),
})

const bandSchema = S.object({
  upTo: S.number(),
  label: S.string().optional(),
})

const bulletItemSchema = S.object({
  label: S.string(),
  value: S.number(),
  target: S.number().optional(),
  max: S.number().optional(),
})

const seriesSchema = S.object({
  name: S.string().optional(),
  values: S.array(S.number()).optional(),
  points: S.array(pointSchema).optional(),
})

const chartSchema = S.object({
  type: S.literal("chart"),
  chart: S.enum([
    "bar",
    "column",
    "line",
    "area",
    "scatter",
    "donut",
    "histogram",
    "sparkline",
    "heatmap",
    "box",
    "gauge",
    "bullet",
    "waterfall",
    "funnel",
    "calendar",
  ]),
  title: S.string().optional(),
  data: S.array(pointSchema).optional(),
  series: S.array(seriesSchema).optional(),
  values: S.array(S.number()).optional(),
  labels: S.array(S.string()).optional(),
  bins: S.number().int().optional(),
  rows: S.array(S.object({ label: S.string().optional(), values: S.array(S.number()) })).optional(),
  items: S.array(bulletItemSchema).optional(),
  bands: S.array(bandSchema).optional(),
  unit: S.string().optional(),
  width: S.number().int().optional(),
  height: S.number().int().optional(),
  max: S.number().optional(),
  min: S.number().optional(),
  value: S.number().optional(),
  stacked: S.boolean().optional(),
  grouped: S.boolean().optional(),
  percent: S.boolean().optional(),
  whiskers: S.enum(["minmax", "tukey"]).optional(),
})

const statsSchema = S.object({
  type: S.literal("stats"),
  title: S.string().optional(),
  items: S.array(
    S.object({
      label: S.string(),
      value: S.union([S.string(), S.number()]),
      unit: S.string().optional(),
      delta: S.string().optional(),
      trend: S.enum(["up", "down", "flat"]).optional(),
      hint: S.string().optional(),
    }),
  ),
})

const tableSchema = S.object({
  type: S.literal("table"),
  title: S.string().optional(),
  columns: S.array(S.string()),
  rows: S.array(S.array(S.union([S.string(), S.number()]))),
  align: S.array(S.enum(["l", "c", "r"])).optional(),
  maxColWidth: S.number().int().optional(),
})

const checklistSchema = S.object({
  type: S.literal("checklist"),
  title: S.string().optional(),
  items: S.array(
    S.object({
      label: S.string(),
      status: S.enum(["todo", "doing", "done", "blocked", "skipped"]),
      detail: S.string().optional(),
    }),
  ),
  percent: S.number().optional(),
})

const calloutSchema = S.object({
  type: S.literal("callout"),
  level: S.enum(["info", "success", "warning", "error", "tip"]),
  title: S.string().optional(),
  body: S.string(),
})

type TreeNodeInput = {
  label: string
  note?: string
  children?: TreeNodeInput[]
}

const treeNodeSchema: z.ZodType<TreeNodeInput> = S.lazy(() =>
  S.object({
    label: S.string(),
    note: S.string().optional(),
    children: S.array(treeNodeSchema).optional(),
  }),
)

const treeSchema = S.object({
  type: S.literal("tree"),
  title: S.string().optional(),
  nodes: S.array(treeNodeSchema),
})

const suggestSchema = S.object({
  type: S.literal("suggest"),
  title: S.string().optional(),
  items: S.array(
    S.object({
      label: S.string(),
      prompt: S.string(),
      description: S.string().optional(),
    }),
  ),
})

const dividerSchema = S.object({
  type: S.literal("divider"),
  label: S.string().optional(),
})

const diffSchema = S.object({
  type: S.literal("diff"),
  title: S.string().optional(),
  path: S.string().optional(),
  patch: S.string().optional(),
  hunks: S
    .array(
      S.object({
        header: S.string(),
        lines: S.array(
          S.object({
            type: S.enum(["ctx", "add", "del"]),
            text: S.string(),
          }),
        ),
      }),
    )
    .optional(),
  showWhitespace: S.boolean().optional(),
})

const kvSchema = S.object({
  type: S.literal("kv"),
  title: S.string().optional(),
  items: S.array(
    S.object({
      label: S.string(),
      value: S.union([S.string(), S.number()]),
    }),
  ),
})

const badgeSchema = S.object({
  type: S.literal("badge"),
  title: S.string().optional(),
  items: S.array(
    S.object({
      name: S.string(),
      value: S.union([S.string(), S.number()]).optional(),
      tone: S.enum(["info", "ok", "warn", "bad"]).optional(),
    }),
  ),
})

const stepperSchema = S.object({
  type: S.literal("stepper"),
  title: S.string().optional(),
  steps: S.array(
    S.object({
      label: S.string(),
      status: S.enum(["done", "active", "todo", "error"]).optional(),
    }),
  ),
})

const emptySchema = S.object({
  type: S.literal("empty"),
  message: S.string(),
  hint: S.string().optional(),
})

const quoteSchema = S.object({
  type: S.literal("quote"),
  text: S.string(),
  attribution: S.string().optional(),
})

const footnotesSchema = S.object({
  type: S.literal("footnotes"),
  title: S.string().optional(),
  items: S.array(S.string()),
})

const elementSchema = S.discriminatedUnion("type", [
  chartSchema,
  statsSchema,
  tableSchema,
  checklistSchema,
  calloutSchema,
  treeSchema,
  suggestSchema,
  dividerSchema,
  diffSchema,
  kvSchema,
  badgeSchema,
  stepperSchema,
  emptySchema,
  quoteSchema,
  footnotesSchema,
])

const DESCRIPTION = [
  "Render static smart-UI art (charts, stat dashboards, tables, checklists, callouts, trees, next-step suggestions, dividers, diffs, key-value lists, badge rows, steppers, empty states, quotes, footnotes) into the chat.",
  "The tool returns a fenced ```text block with pre-rendered terminal art. OpenCode does not render plugin tool output automatically: you MUST include that fenced block verbatim in your markdown reply so the user sees it.",
  "Charts: bar, column (stacked/grouped/percent), line, area, scatter, donut, histogram, sparkline, heatmap, box, gauge, bullet, waterfall, funnel, calendar. Prefer visuals over walls of numbers whenever you have 3+ comparable values, trends, distributions, or progress.",
  "Chart details: box takes raw values per series (whiskers minmax|tukey, default tukey). Gauge takes `value`, optional min/max and `bands` [{upTo,label}] in value space. Bullet takes `items` [{label,value,target?,max?}] and optional `bands` whose upTo is a 0-1 fraction (range ticks). Waterfall takes data with optional per-point type abs|delta|total (default: first abs, rest delta). Calendar takes data points with label YYYY-MM-DD (values for the same date are summed).",
  "Text elements: `diff` renders a code change from a unified `patch` string or structured `hunks` ([{header: \"@@ -12,4 +12,6 @@\", lines: [{type: ctx|add|del, text}]}]), with line numbers, +/- markers, wrapping, and rename/binary metadata. Use `kv` for scannable label/value summaries, `badge` for compact status chips with tones (info|ok|warn|bad), `stepper` for ordered multi-step progress (done|active|todo|error), `empty` for no-results states, `quote` for quoting text with attribution, and `footnotes` for references (the inline ¹ markers in prose are your job).",
  "Optional side effects: `prefill` (1-based index of a suggest element item) places that item's prompt into the user's TUI input box; `autoSubmit` also submits it; `toast` shows a TUI toast.",
  "Pass `update: true` to re-render the most recent ui_render card of this session in place instead of posting a new card — use it for refreshes of the same chart or dashboard.",
].join(" ")

export function createRenderTool(deps: { client: PluginInput["client"]; width: number; parts?: PartBridge }): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      elements: S.array(elementSchema).min(1).max(8).optional(),
      element: elementSchema.optional(),
      width: S.number().int().min(40).max(120).optional(),
      prefill: S.number().int().min(1).optional(),
      autoSubmit: S.boolean().optional(),
      update: S.boolean().optional().describe("refresh the most recent ui_render card of this session in place with this rendering"),
      toast: S
        .object({
          message: S.string(),
          title: S.string().optional(),
          variant: S.enum(["info", "success", "warning", "error"]).optional(),
          duration: S.number().int().optional(),
        })
        .optional(),
    },
    async execute(args, context) {
      const elements = (args.elements ?? (args.element ? [args.element] : [])) as Element[]
      if (elements.length === 0) throw new Error("provide `elements` (array) or `element` (single)")
      const width = clamp(args.width ?? deps.width, 40, 120)
      const suggest = elements.find((element): element is SuggestElement => element.type === "suggest")
      let prefillIndex: number | undefined
      if (args.prefill !== undefined) {
        if (!suggest) throw new Error("`prefill` requires a suggest element in the same call")
        if (args.prefill < 1 || args.prefill > suggest.items.length) {
          throw new Error(`prefill must be between 1 and ${suggest.items.length} (the suggest element has ${suggest.items.length} items)`)
        }
        prefillIndex = args.prefill
      }
      const lines = renderElements(elements, { width, prefillIndex })
      const types = [...new Set(elements.map((element) => element.type))].join(" + ")
      const bridge = deps.parts
      if (args.update && bridge) {
        const latest = bridge.latestRender(context.sessionID)
        if (latest && (await bridge.patch(context.sessionID, latest, lines))) {
          context.metadata({ title: `ui_render · ${types} (updated in place)` })
          return [
            "The previous card was updated in place with the new rendering.",
            "Reply with one short line telling the user what changed — do not repeat the art.",
          ].join("\n")
        }
      }
      if (bridge) {
        const cardId = newUiId()
        bridge.register(context.sessionID, cardId, "render", lines)
        bridge.markLatestRender(context.sessionID, cardId)
      }
      context.metadata({ title: `ui_render · ${types}` })
      if (prefillIndex !== undefined && suggest) {
        const prompt = suggest.items[prefillIndex - 1]!.prompt
        try {
          await deps.client.tui.appendPrompt({ body: { text: prompt } })
          if (args.autoSubmit) await deps.client.tui.submitPrompt({})
        } catch {}
      }
      if (args.toast) {
        try {
          await deps.client.tui.showToast({
            body: {
              message: args.toast.message,
              title: args.toast.title,
              variant: args.toast.variant ?? "info",
              duration: args.toast.duration,
            },
          })
        } catch {}
      }
      return [
        "```text",
        ...lines,
        "```",
        "",
        "Show the user the rendered art by including exactly the fenced ```text block above verbatim in your markdown reply. Do not retype it from memory and do not add characters to it.",
      ].join("\n")
    },
  })
}
