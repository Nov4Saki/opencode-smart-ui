import type { PluginOptions } from "@opencode-ai/plugin"

export type Surface = "image" | "art"

export type SmartUiOptions = {
  surface: Surface
  injectPrompt: boolean
}

export function resolveOptions(raw?: PluginOptions): SmartUiOptions {
  const surface: Surface = raw?.surface === "art" ? "art" : "image"
  const injectPrompt = raw?.injectPrompt !== false
  return { surface, injectPrompt }
}
