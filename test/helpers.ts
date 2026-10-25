import type { ToolContext } from "@opencode-ai/plugin"

export type TuiCalls = {
  appendPrompt: { body?: { text: string } }[]
  submitPrompt: number
  showToast: { body?: Record<string, unknown> }[]
}

export function fakeClient() {
  const calls: TuiCalls = { appendPrompt: [], submitPrompt: 0, showToast: [] }
  const client = {
    tui: {
      appendPrompt: async (options: { body?: { text: string } }) => {
        calls.appendPrompt.push(options)
        return true
      },
      submitPrompt: async () => {
        calls.submitPrompt += 1
        return true
      },
      showToast: async (options: { body?: Record<string, unknown> }) => {
        calls.showToast.push(options)
        return true
      },
    },
  }
  return { client, calls }
}

export function fakeContext(sessionID = "s1") {
  const titles: string[] = []
  const context = {
    sessionID,
    messageID: "m1",
    agent: "build",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata(input: { title?: string }) {
      if (input.title) titles.push(input.title)
    },
    ask: () => {
      throw new Error("ask should not be called")
    },
  } as unknown as ToolContext
  return { context, titles }
}

export async function run(toolDef: { execute: Function }, args: unknown, context: unknown): Promise<string> {
  const result = (await toolDef.execute(args, context)) as string | { output: string }
  return typeof result === "string" ? result : result.output
}
