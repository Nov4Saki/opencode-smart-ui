import { renderElements, type Element } from "./render/elements.ts"
import { truncate, wrapText } from "./render/util.ts"

export type FlashcardRating = "again" | "hard" | "good" | "easy"

export type DeckCard = {
  front: string
  back: string
  hint?: string
}

export type DeckEntry = FlashcardRating | "skip" | null

export type DeckRecord = {
  id: string
  sessionID: string
  title?: string
  created: number
  cards: DeckCard[]
  ratings: DeckEntry[]
  intervals: number[]
  revealed: boolean[]
  next: number
}

const FRONT_MAX = 200
const BACK_MAX = 600

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function normalizeCards(inputs: { front: string; back: string; hint?: string }[]): DeckCard[] {
  if (inputs.length === 0) throw new Error("flashcards need at least one card")
  if (inputs.length > 20) throw new Error("at most 20 flashcards per deck")
  return inputs.map((input, index) => {
    const front = collapse(input.front)
    const back = collapse(input.back)
    if (!front) throw new Error(`card ${index + 1} needs front text`)
    if (!back) throw new Error(`card ${index + 1} needs back text`)
    return {
      front: truncate(front, FRONT_MAX),
      back: truncate(back, BACK_MAX),
      hint: input.hint ? truncate(collapse(input.hint), FRONT_MAX) : undefined,
    }
  })
}

export function nextInterval(current: number, rating: FlashcardRating): number {
  const base = Math.max(1, current)
  if (rating === "again") return 1
  if (rating === "hard") return base
  return base * 2
}

export function deckSummary(record: Pick<DeckRecord, "id" | "next" | "cards" | "revealed">): string {
  const index = Math.min(record.next, record.cards.length - 1)
  const state = record.next >= record.cards.length ? "done" : record.revealed[index] ? "awaiting rating" : "hidden"
  return `flashcard ${record.id} card ${Math.min(record.next + 1, record.cards.length)}/${record.cards.length} ${state}`
}

export function renderDeckCard(card: DeckCard, index: number, total: number, revealed: boolean, title: string | undefined, maxWidth: number): string[] {
  const lines: string[] = []
  const header = `${title ?? "Flashcards"} · card ${index + 1}/${total}${revealed ? " — answer" : ""}`
  lines.push(truncate(header, maxWidth))
  lines.push(...wrapText(card.front, maxWidth - 2).map((line) => "│ " + line))
  if (revealed) {
    lines.push("│")
    lines.push(...wrapText(card.back, maxWidth - 2).map((line) => "│ " + line))
    if (card.hint) lines.push(...wrapText(`hint: ${card.hint}`, maxWidth - 2).map((line) => "│ " + line))
  }
  return lines
}

export function flashcardDockInstruction(deckId: string, card: DeckCard, index: number, total: number): string[] {
  const payload = JSON.stringify({
    questions: [
      {
        header: `Card ${index + 1}/${total}`,
        question: card.front,
        options: [
          { label: "Reveal answer", description: "show the back of the card" },
          { label: "Skip", description: "put it aside without rating" },
        ],
        custom: false,
      },
    ],
  })
  return [
    "NEXT STEP — required: call the `question` tool right now with exactly this argument:",
    payload,
    "Do not paraphrase, reorder, or add questions.",
    `When the question tool returns: if the user chose "Reveal answer", call \`ui_reveal\` with deckId "${deckId}" and cardIndex ${index}; if they chose "Skip", call \`ui_reveal\` with deckId "${deckId}", cardIndex ${index} and action "skip".`,
    `Never write out the back of this card yourself — only ui_reveal renders it.`,
  ]
}

export function ratingDockInstruction(deckId: string, index: number): string[] {
  const payload = JSON.stringify({
    questions: [
      {
        header: "Self rating",
        question: "How well did you know this card?",
        options: ["Again", "Hard", "Good", "Easy"],
        custom: false,
      },
    ],
  })
  return [
    "NEXT STEP — required: call the `question` tool right now with exactly this argument:",
    payload,
    "Do not paraphrase, reorder, or add questions.",
    `When the question tool returns, call \`ui_reveal\` with deckId "${deckId}", cardIndex ${index} and rating set to the chosen label lowercased ("again", "hard", "good" or "easy").`,
  ]
}

export function renderDeckSummary(record: Pick<DeckRecord, "title" | "cards" | "ratings" | "intervals">, maxWidth: number): string[] {
  const rated = record.ratings.filter((entry): entry is FlashcardRating => entry !== null && entry !== "skip")
  const again = rated.filter((entry) => entry === "again").length
  const strong = rated.filter((entry) => entry === "good" || entry === "easy").length
  const intervalDays = record.intervals.filter((days) => days > 0)
  const avgInterval = intervalDays.length === 0 ? 0 : Math.round(intervalDays.reduce((sum, days) => sum + days, 0) / intervalDays.length)
  const elements: Element[] = [
    {
      type: "stats",
      title: `${record.title ?? "Flashcard deck"} — session summary`,
      items: [
        { label: "Cards", value: `${record.ratings.filter((entry) => entry !== null).length}/${record.cards.length}` },
        { label: "Strong", value: strong },
        { label: "Again", value: again },
        { label: "Avg interval", value: `${avgInterval}d` },
      ],
    },
    {
      type: "checklist",
      title: "Card review",
      items: record.cards.map((card, index) => {
        const entry = record.ratings[index] ?? null
        const status = entry === "again" ? "blocked" : entry === "skip" ? "skipped" : entry === "hard" ? "doing" : entry === null ? "todo" : "done"
        const detail = entry === null ? undefined : entry === "skip" ? "skipped" : `${entry} · next in ${record.intervals[index] ?? 0}d`
        return { label: card.front, status, detail }
      }),
    },
  ]
  return renderElements(elements, { width: maxWidth })
}
