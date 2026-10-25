import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { formatValues } from "../form-core.ts"
import { getForm } from "../state.ts"

const S = tool.schema

const DESCRIPTION = [
  "Collect the answers of a pending smartui form when the user says the submission did not arrive (recovery only — submissions normally arrive automatically as a user message).",
  "Forms are created by writing a ```smartui-form block; pass the form `key` shown in the pending smartui state line.",
].join(" ")

export function createFormCollectTool(): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      key: S.string().describe("form id of the pending form to collect"),
    },
    async execute(args, context) {
      const record = getForm(args.key)
      if (!record || record.sessionID !== context.sessionID) {
        throw new Error(
          `smartui_form: unknown key "${args.key}" for this session — it may have expired (6h TTL)`,
        )
      }
      if (!record.answers) {
        return `Form "${record.id}" has not been submitted yet — nothing to collect.`
      }
      const lines = [`Submitted answers for form "${record.id}" («${record.title ?? "quick form"}»):`]
      record.answers.entries.forEach((entry, i) => {
        lines.push(`- ${entry.label}: ${formatValues(record.questions[i]!, entry.values)}`)
      })
      return lines.join("\n")
    },
  })
}
