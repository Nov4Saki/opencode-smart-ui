import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { nextStepInstruction, type DockInput } from "../dock.ts"

const S = tool.schema

const optionSchema = S.union([S.string(), S.object({ label: S.string(), description: S.string().optional() })])

const questionSchema = S.object({
  header: S.string().optional(),
  question: S.string(),
  options: S.array(optionSchema)
    .max(12)
    .optional()
    .describe("menu choices; omit or pass [] for a free-text (fill-in) question — the dock shows 'Type your own answer'"),
  multiple: S.boolean().optional().describe("allow selecting more than one option"),
  custom: S.boolean().optional().describe("allow a typed answer (adds a free-text choice)"),
})

const DESCRIPTION = [
  "Ask the user a question — a menu (pick an option) or a form (structured input). The user's choice decides what happens next.",
  "A question with no `options` (or []) is free-text: the typed text comes back as the answer.",
  "Dock mode (default): returns an INLINE CARD (write it into the chat first, so the questions render inline) plus an ACTION section: you must immediately call the built-in `question` tool with the exact JSON given, then continue from the user's answers. Do not print the ACTION section.",
  "Chat mode (`inline: true`): no dock — write the card, end your turn, and the user answers with a normal chat message you then read.",
  "Use this for real decisions, not for rhetorical questions.",
].join(" ")

export function cardFromQuestions(
  purpose: "menu" | "form",
  title: string | undefined,
  intro: string | undefined,
  questions: { header?: string; question: string; options?: { label: string; description?: string }[]; multiple?: boolean }[],
): string {
  const lines: string[] = []
  if (title) lines.push(`**${purpose === "menu" ? "Menu" : "Form"} — ${title}**`)
  else lines.push(`**${purpose === "menu" ? "Menu" : "Form"}**`)
  if (intro) lines.push("", intro)
  lines.push("")
  questions.forEach((question, i) => {
    const prefix = questions.length > 1 ? `${i + 1}. ` : ""
    lines.push(`${prefix}**${question.header ? `${question.header}: ` : ""}${question.question}**`)
    if (!question.options || question.options.length === 0) {
      lines.push("   _Type your answer_")
    } else {
      question.options.forEach((option, j) => {
        lines.push(`   ${j + 1}. \`${option.label}\`${option.description ? ` — ${option.description}` : ""}`)
      })
    }
    if (question.multiple) lines.push("   _select all that apply_")
    if (i < questions.length - 1) lines.push("")
  })
  return lines.join("\n")
}

export function createAskTool(): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      purpose: S.enum(["menu", "form"]),
      title: S.string().optional(),
      intro: S.string().optional(),
      inline: S.boolean().optional().describe("chat mode: no dock — write the card and wait for the user's typed reply in chat"),
      questions: S.array(questionSchema).min(1).max(6),
    },
    async execute(args, context) {
      const dock: DockInput = {
        questions: args.questions.map((question) => {
          const options = (question.options ?? []).map((option) =>
            typeof option === "string"
              ? { label: option, description: "" }
              : { label: option.label, description: option.description ?? "" },
          )
          return {
            header: question.header,
            question: question.question,
            multiple: question.multiple,
            custom: options.length === 0 ? true : question.custom,
            options,
          }
        }),
      }
      context.metadata({ title: `smartui_ask · ${args.purpose} (${args.questions.length}q)${args.inline ? " · chat" : ""}` })
      if (args.inline) {
        const hint = args.purpose === "menu" ? "_Reply in chat — the number or the label._" : "_Reply in chat with each answer._"
        const card = [cardFromQuestions(args.purpose, args.title, args.intro, dock.questions), "", hint].join("\n")
        return [
          "INLINE CARD (chat mode) — write this block into the chat verbatim and exactly as-is, then END YOUR TURN and wait for the user's reply. Do NOT call the question tool.",
          "",
          card,
          "",
          "When the user replies in chat, read the answer(s) from their message and continue.",
        ].join("\n")
      }
      const card = cardFromQuestions(args.purpose, args.title, args.intro, dock.questions)
      return [
        "INLINE CARD — write this block into the chat first, verbatim and exactly as-is, then immediately execute the ACTION (the user reads the questions inline as the dock opens):",
        "",
        card,
        "",
        nextStepInstruction(dock),
      ].join("\n")
    },
  })
}
