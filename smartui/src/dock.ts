export type DockQuestion = {
  header?: string
  question: string
  options: { label: string; description?: string }[]
  multiple?: boolean
  custom?: boolean
}

export type DockInput = { questions: DockQuestion[] }

export function nextStepInstruction(input: DockInput): string {
  return [
    "ACTION — do not print this section, just execute it:",
    "NEXT STEP: right after writing the card above, call the built-in `question` tool with exactly this input (JSON):",
    JSON.stringify(input),
    "Then continue based on the user's answers.",
  ].join("\n")
}
