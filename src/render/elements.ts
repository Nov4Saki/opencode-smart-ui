import { renderChart, type ChartInput } from "./chart.ts"
import {
  renderBadge,
  renderDiff,
  renderEmpty,
  renderFootnotes,
  renderKv,
  renderQuote,
  renderStepper,
  type BadgeInput,
  type DiffInput,
  type EmptyInput,
  type FootnotesInput,
  type KvInput,
  type QuoteInput,
  type StepperInput,
} from "./text.ts"
import { limitHeight, truncate } from "./util.ts"
import {
  renderCallout,
  renderChecklist,
  renderDivider,
  renderStats,
  renderSuggest,
  renderTable,
  renderTree,
  type CalloutInput,
  type ChecklistInput,
  type DividerInput,
  type StatsInput,
  type SuggestInput,
  type TableInput,
  type TreeInput,
} from "./widgets.ts"

export type ChartElement = { type: "chart" } & ChartInput
export type StatsElement = { type: "stats" } & StatsInput
export type TableElement = { type: "table" } & TableInput
export type ChecklistElement = { type: "checklist" } & ChecklistInput
export type CalloutElement = { type: "callout" } & CalloutInput
export type TreeElement = { type: "tree" } & TreeInput
export type SuggestElement = { type: "suggest" } & SuggestInput
export type DividerElement = { type: "divider" } & DividerInput
export type DiffElement = { type: "diff" } & DiffInput
export type KvElement = { type: "kv" } & KvInput
export type BadgeElement = { type: "badge" } & BadgeInput
export type StepperElement = { type: "stepper" } & StepperInput
export type EmptyElement = { type: "empty" } & EmptyInput
export type QuoteElement = { type: "quote" } & QuoteInput
export type FootnotesElement = { type: "footnotes" } & FootnotesInput

export type Element =
  | ChartElement
  | StatsElement
  | TableElement
  | ChecklistElement
  | CalloutElement
  | TreeElement
  | SuggestElement
  | DividerElement
  | DiffElement
  | KvElement
  | BadgeElement
  | StepperElement
  | EmptyElement
  | QuoteElement
  | FootnotesElement

export type RenderConfig = {
  width: number
  prefillIndex?: number
}

export function renderElement(element: Element, config: RenderConfig): string[] {
  const lines = renderLines(element, config).map((line) => truncate(line.replace(/\s+$/, ""), config.width))
  return limitHeight(lines)
}

function renderLines(element: Element, config: RenderConfig): string[] {
  switch (element.type) {
    case "chart":
      return renderChart(element, config.width)
    case "stats":
      return renderStats(element, config.width)
    case "table":
      return renderTable(element, config.width)
    case "checklist":
      return renderChecklist(element, config.width)
    case "callout":
      return renderCallout(element, config.width)
    case "tree":
      return renderTree(element, config.width)
    case "suggest":
      return renderSuggest(element, config.width, config.prefillIndex)
    case "divider":
      return renderDivider(element, config.width)
    case "diff":
      return renderDiff(element, config.width)
    case "kv":
      return renderKv(element, config.width)
    case "badge":
      return renderBadge(element, config.width)
    case "stepper":
      return renderStepper(element, config.width)
    case "empty":
      return renderEmpty(element, config.width)
    case "quote":
      return renderQuote(element, config.width)
    case "footnotes":
      return renderFootnotes(element, config.width)
    default: {
      const unknown = element as { type?: string }
      throw new Error(`unknown element type "${String(unknown.type)}"`)
    }
  }
}

export function renderElements(elements: Element[], config: RenderConfig): string[] {
  if (elements.length === 0) throw new Error("no elements to render")
  const lines: string[] = []
  elements.forEach((element, index) => {
    if (index > 0) lines.push("")
    try {
      lines.push(...renderElement(element, config))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`element ${index + 1} (${element.type}): ${message}`)
    }
  })
  return lines
}
