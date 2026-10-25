export function safeAlt(text: string): string {
  return text.replace(/[[\]()]/g, "").replace(/\s+/g, " ").trim() || "chart"
}

export function urlPayload(alt: string, url: string): string {
  return `![${safeAlt(alt)}](${url})`
}

export function artFence(lines: string[]): string {
  return ["```text", ...lines, "```"].join("\n")
}
