import type { Plugin } from "@opencode-ai/plugin"
import { createBlockProcessor } from "./block-core.ts"
import { createBridge, debugLog } from "./bridge.ts"
import { createChartStore, defaultDataDir } from "./chart-store.ts"
import { answersFromQuery, alreadySubmittedPage, confirmationPage, expiredPage, submittedMessage, submittedReceiptHtml } from "./form-core.ts"
import { createFormStore, loadForm } from "./form-store.ts"
import { createFormLogWatcher, desktopLogRoots, FORM_ACTION_SCHEME, type LogSubmission } from "./log-transport.ts"
import { resolveOptions } from "./options.ts"
import { SYSTEM_PROMPT } from "./prompts.ts"
import { createChartServer } from "./server.ts"
import { pendingSummary } from "./state.ts"
import { createAskTool } from "./tools/ask.ts"
import { createFormCollectTool } from "./tools/form.ts"
import { createQuizTool } from "./tools/quiz.ts"

export const SmartUiPlugin: Plugin = async (input, options) => {
  const config = resolveOptions(options)
  const baseUrl = input.serverUrl ? String(input.serverUrl) : undefined
  const bridge = createBridge({ client: input.client, baseUrl })

  const dataDir = defaultDataDir(process.env)
  const formStore = createFormStore({ dir: dataDir })

  const handleFormSubmission = async (key: string, query: URLSearchParams) => {
    const record = loadForm(key, formStore)
    if (!record) return { status: 404, html: expiredPage() }
    if (record.answers) return { status: 200, html: alreadySubmittedPage() }
    record.answers = { entries: answersFromQuery(record, query), at: Date.now() }
    formStore.save(record)
    debugLog(`form-submit ${key} entries=${record.answers.entries.length}`)
    const delivered = await bridge.postUserMessage(record.sessionID, submittedMessage(record))
    try {
      await bridge.updatePayload(record.sessionID, record.id, submittedReceiptHtml(record))
    } catch (error) {
      debugLog(`form-swap-error ${String(error)}`)
    }
    return { status: 200, html: confirmationPage(record, delivered) }
  }

  const charts = createChartServer({
    store: createChartStore({ dir: dataDir }),
    onFormSubmit: (key, query) => handleFormSubmission(key, query),
  })

  const watcher = createFormLogWatcher({
    roots: desktopLogRoots(process.env),
    onSubmission: (submission: LogSubmission) => {
      void handleFormSubmission(submission.key, submission.query)
    },
  })
  watcher.start()

  const formAction = async (key: string): Promise<string | undefined> => {
    const force = process.env.SMARTUI_FORM_TRANSPORT
    if (force === "http") return charts.formUrl(key)
    if (force === "log") return `${FORM_ACTION_SCHEME}://${key}`
    if (watcher.available()) return `${FORM_ACTION_SCHEME}://${key}`
    return charts.formUrl(key)
  }

  const baseDirs = Array.from(
    new Set(
      [input.directory, process.cwd(), input.worktree].filter(
        (dir): dir is string => typeof dir === "string" && dir.length > 0,
      ),
    ),
  )

  const blocks = createBlockProcessor({
    bridge,
    surface: config.surface,
    charts,
    baseDirs,
    formAction,
    onFormRecord: (record) => formStore.save(record),
  })

  const hooks: Awaited<ReturnType<Plugin>> = {
    tool: {
      smartui_ask: createAskTool(),
      smartui_quiz: createQuizTool(),
      smartui_form: createFormCollectTool(),
    },
    async event({ event }) {
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.type === "text" && typeof part.text === "string") {
          bridge.observeText(part.sessionID, part.messageID, part.id, part, part.text)
          blocks.observe(part.sessionID, part.messageID, part.id, part, part.text)
        }
        return
      }
      if (event.type === "message.part.removed") {
        const properties = event.properties as { messageID?: string; partID?: string }
        if (properties.messageID && properties.partID) {
          bridge.onPartRemoved(properties.messageID, properties.partID)
          blocks.forget(properties.messageID, properties.partID)
        }
        return
      }
      if (event.type === "message.updated") {
        const info = event.properties.info
        if (info.role === "assistant" && info.time.completed) {
          await blocks.flushMessage(info.sessionID, info.id)
          await bridge.flushMessage(info.sessionID, info.id)
        }
        return
      }
      if (event.type === "session.idle") {
        await blocks.flushSession(event.properties.sessionID)
        await bridge.flushSession(event.properties.sessionID)
        return
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
