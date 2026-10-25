export function composeCard(card: string[], instructions: string[]): string {
  return [
    "```text",
    ...card,
    "```",
    "",
    "Include only the fenced ```text block above verbatim in your markdown reply — do not include these instructions.",
    "",
    ...instructions,
  ].join("\n")
}
