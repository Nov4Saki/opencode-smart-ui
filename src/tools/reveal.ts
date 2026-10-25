import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { deckSummary, flashcardDockInstruction, nextInterval, ratingDockInstruction, renderDeckCard, renderDeckSummary, type DeckRecord } from "../deck-core.ts"
import type { PartBridge } from "../parts.ts"
import { dropState, getState, putState } from "../state.ts"
import { clamp } from "../render/util.ts"
import { composeCard } from "./compose.ts"

const S = tool.schema

const DESCRIPTION = [
  "Advance a flashcard deck created with ui_ask (flashcards:true).",
  "Call with deckId and cardIndex to reveal the back of the current card; the response includes a NEXT STEP instruction to collect a self-rating (Again/Hard/Good/Easy) via the question dock and send it back through ui_reveal as `rating`.",
  "Send action:\"skip\" to set a card aside, or a rating to schedule it (SM-2-lite: Good/Easy double the interval, Hard keeps it, Again resets to 1 day). The last card returns a session summary. Never reveal card backs yourself — only ui_reveal renders them.",
  "The deck card in the conversation is updated in place as the deck advances — when the tool says the card was updated, do not repeat the card art.",
].join(" ")

export function createRevealTool(deps: { width: number; parts?: PartBridge }): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      deckId: S.string(),
      cardIndex: S.number().int().min(0),
      action: S.enum(["reveal", "skip"]).optional().describe('default "reveal"; "skip" sets the card aside without rating'),
      rating: S.enum(["again", "hard", "good", "easy"]).optional(),
      width: S.number().int().min(40).max(120).optional(),
    },
    async execute(args, context) {
      const width = clamp(args.width ?? deps.width, 40, 120)
      const record = getState(args.deckId)
      if (!record || record.sessionID !== context.sessionID || record.kind !== "flashcard") {
        throw new Error(`unknown deckId "${args.deckId}" — it may be finished already or belongs to another session`)
      }
      const deck = record.payload as DeckRecord
      if (args.cardIndex !== deck.next) {
        throw new Error(`cardIndex ${args.cardIndex} is out of order — card ${deck.next + 1} is up next`)
      }
      const index = args.cardIndex
      const patchInPlace = async (art: string[]): Promise<boolean> =>
        deps.parts ? deps.parts.patch(context.sessionID, deck.id, art) : false

      const advance = async (): Promise<string> => {
        if (deck.next >= deck.cards.length) {
          const lines = renderDeckSummary(deck, width)
          const patched = await patchInPlace(lines)
          dropState(deck.id)
          deps.parts?.drop(context.sessionID, deck.id)
          context.metadata({ title: `ui_reveal · deck done (${deck.cards.length})` })
          if (patched) {
            return [
              "The deck card above now shows the session summary — the deck is complete.",
              "Reply with one short closing line (what to revisit tomorrow, or an offer to run another deck).",
            ].join("\n")
          }
          return [
            "```text",
            ...lines,
            "```",
            "",
            "The deck is complete — include exactly the fenced ```text block above verbatim in your markdown reply, then add one short closing line (what to revisit tomorrow, or an offer to run another deck).",
          ].join("\n")
        }
        putState({ ...record, summary: deckSummary(deck), payload: deck })
        const nextIndex = deck.next
        const card = renderDeckCard(deck.cards[nextIndex]!, nextIndex, deck.cards.length, false, deck.title, width)
        const patched = await patchInPlace(card)
        context.metadata({ title: `ui_reveal · card ${deck.next + 1}/${deck.cards.length}` })
        if (patched) {
          return [
            `The deck card above now shows card ${nextIndex + 1}/${deck.cards.length}.`,
            "Reply with one short line only — do not repeat the card art.",
            "",
            ...flashcardDockInstruction(deck.id, deck.cards[nextIndex]!, nextIndex, deck.cards.length),
          ].join("\n")
        }
        return composeCard(card, flashcardDockInstruction(deck.id, deck.cards[nextIndex]!, nextIndex, deck.cards.length))
      }

      if (args.action === "skip") {
        deck.ratings[index] = "skip"
        deck.next = index + 1
        return advance()
      }

      if (args.rating) {
        if (!deck.revealed[index]) throw new Error(`card ${index + 1} must be revealed before rating`)
        deck.ratings[index] = args.rating
        deck.intervals[index] = nextInterval(deck.intervals[index] ?? 1, args.rating)
        deck.next = index + 1
        return advance()
      }

      deck.revealed[index] = true
      putState({ ...record, summary: deckSummary(deck), payload: deck })
      const card = renderDeckCard(deck.cards[index]!, index, deck.cards.length, true, deck.title, width)
      const patched = await patchInPlace(card)
      context.metadata({ title: `ui_reveal · card ${index + 1} revealed` })
      if (patched) {
        return [
          `The deck card above now shows the answer for card ${index + 1}/${deck.cards.length}.`,
          "Reply with one short line only — do not repeat the card art.",
          "",
          ...ratingDockInstruction(deck.id, index),
        ].join("\n")
      }
      return composeCard(card, ratingDockInstruction(deck.id, index))
    },
  })
}
