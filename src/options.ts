import type { PluginOptions } from "@opencode-ai/plugin"
import { clamp } from "./render/util.ts"

export type UiOptions = {
  width: number
  injectPrompt: boolean
}

export function resolveOptions(raw?: PluginOptions): UiOptions {
  const width = typeof raw?.width === "number" ? clamp(Math.round(raw.width), 40, 120) : 72
  const injectPrompt = raw?.injectPrompt !== false
  return { width, injectPrompt }
}
