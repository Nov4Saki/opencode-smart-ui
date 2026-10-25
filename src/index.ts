import type { Plugin } from "@opencode-ai/plugin"
import { resolveOptions } from "./options.ts"
import { createPartBridge, debugLog, resolveBaseUrl } from "./parts.ts"
import { SYSTEM_PROMPT } from "./prompts.ts"
import { pendingSummary } from "./state.ts"
import { createAskTool } from "./tools/ask.ts"
import { createQuizCheckTool } from "./tools/quiz.ts"
import { createRenderTool } from "./tools/render.ts"
import { createRevealTool } from "./tools/reveal.ts"

export const SmartUiPlugin: Plugin = async (input, options) => {
  const config = resolveOptions(options)
  const parts = createPartBridge({ client: input.client, baseUrl: resolveBaseUrl(input) })
  const hooks: Awaited<ReturnType<Plugin>> = {
    tool: {
      ui_render: createRenderTool({ client: input.client, width: config.width, parts }),
      ui_ask: createAskTool({ width: config.width, parts }),
      ui_quiz_check: createQuizCheckTool({ width: config.width, parts }),
      ui_reveal: createRevealTool({ width: config.width, parts }),
    },
    async event({ event }) {
      if (event.type !== "message.part.updated") debugLog(`event ${event.type}`)
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        debugLog(`event part.updated type=${part.type} id=${part.id} len=${part.type === "text" ? part.text.length : "n/a"}`)
        if (part.type === "text" && typeof part.text === "string") {
          parts.bindFromText(part.sessionID, part.messageID, part.id, part, part.text)
        }
        return
      }
      if (event.type === "message.part.removed") {
        const properties = event.properties as { messageID?: string; partID?: string }
        if (properties.messageID && properties.partID) parts.removePart(properties.messageID, properties.partID)
      }
    },
    async "experimental.chat.system.transform"(hookInput, output) {
      if (config.injectPrompt) output.system.push(SYSTEM_PROMPT)
      if (hookInput.sessionID) {
        const summary = pendingSummary(hookInput.sessionID)
        if (summary) output.system.push(summary)
      }
    },
  }
  return hooks
}

export default SmartUiPlugin
