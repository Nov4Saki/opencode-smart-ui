import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { normalizeAskQuestions, questionCallInstruction, questionSpecFrom, renderAskCard, type AskPurpose, type QuestionSpec } from "../ask-core.ts"
import { bindAccepted, parseAccepted, quizSummary, type QuizRecord } from "../quiz-core.ts"
import { deckSummary, flashcardDockInstruction, normalizeCards, renderDeckCard, type DeckRecord } from "../deck-core.ts"
import type { PartBridge } from "../parts.ts"
import { getState, newUiId, putState } from "../state.ts"
import { clamp } from "../render/util.ts"
import { composeCard } from "./compose.ts"

const S = tool.schema

const optionSchema = S.union([
  S.string(),
  S.object({
    label: S.string(),
    description: S.string().optional(),
  }),
])

const questionSchema = S.object({
  header: S.string().optional(),
  question: S.string(),
  options: S.array(optionSchema).min(2),
  multiple: S.boolean().optional(),
  custom: S.boolean().optional(),
})

const quizQuestionSchema = S.object({
  header: S.string().optional(),
  question: S.string(),
  options: S.array(optionSchema).min(2),
  answer: S
    .string()
    .describe(
      "correct option label, exactly as written in options; separate alternative accepted labels with |. With multiple:true list the complete required set.",
    ),
  multiple: S.boolean().optional().describe("true for pick-all-that-apply questions; grading then requires the exact full set"),
  explanation: S.string().optional().describe("shown to the user when grading, right or wrong"),
})

const cardSchema = S.object({
  front: S.string().describe("prompt side of the card"),
  back: S.string().describe("answer side, revealed only through ui_reveal"),
  hint: S.string().optional().describe("optional nudge shown on the reveal card"),
})

const DESCRIPTION = [
  "Ask the user structured questions in the interactive TUI question dock — a menu (pick an option), a form (structured input), a quiz (knowledge check with grading), or flashcards (spaced-repetition study deck).",
  "Returns a fenced ```text card (include it verbatim in your reply) plus a NEXT STEP instruction: you must immediately call the built-in `question` tool with the exact JSON given, then continue from the user's answers.",
  "Quizzes: one call creates a quizId. Batch mode (default) grades everything at once via ui_quiz_check. With oneAtATime:true only question 1 is served; continue by calling ui_ask with the quizId and the next questionIndex, grading each question via ui_quiz_check with its questionIndex.",
  "Flashcards: pass flashcards:true plus a cards array; ui_reveal drives reveal/rating/advance. Never reveal answers or card backs before grading or revealing.",
].join(" ")

function specFromQuizQuestion(spec: QuizRecord["questions"][number]): QuestionSpec {
  return questionSpecFrom(spec)
}

export function createAskTool(deps: { width: number; parts?: PartBridge }): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      purpose: S.enum(["menu", "form", "quiz"]),
      title: S.string().optional(),
      intro: S.string().optional(),
      questions: S.array(questionSchema).min(1).max(6).optional(),
      quiz: S.array(quizQuestionSchema).min(1).max(6).optional(),
      oneAtATime: S.boolean().optional().describe("quiz only: serve one question per turn; continue with quizId + questionIndex"),
      quizId: S.string().optional().describe("one-at-a-time quiz: id returned by the first ui_ask call"),
      questionIndex: S.number().int().min(0).optional().describe("one-at-a-time quiz: 0-based index of the question to serve"),
      flashcards: S.boolean().optional().describe("quiz purpose only: start a spaced-repetition flashcard deck"),
      cards: S.array(cardSchema).min(1).max(20).optional().describe("flashcard deck contents when flashcards:true"),
      width: S.number().int().min(40).max(120).optional(),
    },
    async execute(args, context) {
      const width = clamp(args.width ?? deps.width, 40, 120)
      const purpose = args.purpose as AskPurpose

      if (purpose === "quiz" && args.quizId) {
        const record = getState(args.quizId)
        if (!record || record.sessionID !== context.sessionID || record.kind !== "quiz") {
          throw new Error(`unknown quizId "${args.quizId}" — it may be finished already or belongs to another session`)
        }
        const quiz = record.payload as QuizRecord
        if (quiz.mode !== "one") throw new Error(`quiz "${quiz.id}" is a batch quiz — grade it with ui_quiz_check in one call`)
        const index = args.questionIndex ?? quiz.next
        if (index !== quiz.next) {
          throw new Error(`questionIndex ${index} is out of order — the next unanswered question is ${quiz.next} (question ${quiz.next + 1})`)
        }
        const spec = specFromQuizQuestion(quiz.questions[index]!)
        context.metadata({ title: `ui_ask · quiz q${index + 1}/${quiz.questions.length}` })
        const card = renderAskCard({ specs: [spec], purpose, title: args.title ?? quiz.title, intro: args.intro, width })
        deps.parts?.register(context.sessionID, quiz.id, "quiz", card)
        return composeCard(card, questionCallInstruction([spec], { quizId: quiz.id, checkTool: "ui_quiz_check", questionIndex: index }))
      }

      if (purpose === "quiz" && args.flashcards) {
        if (!args.cards || args.cards.length === 0) throw new Error('flashcards mode requires the `cards` array (front/back per card)')
        const cards = normalizeCards(args.cards)
        const deck: DeckRecord = {
          id: newUiId(),
          sessionID: context.sessionID,
          title: args.title,
          created: Date.now(),
          cards,
          ratings: cards.map(() => null),
          intervals: cards.map(() => 0),
          revealed: cards.map(() => false),
          next: 0,
        }
        putState({ id: deck.id, sessionID: deck.sessionID, kind: "flashcard", summary: deckSummary(deck), created: deck.created, payload: deck })
        context.metadata({ title: `ui_ask · flashcards (${cards.length})` })
        const card = renderDeckCard(cards[0]!, 0, cards.length, false, deck.title, width)
        deps.parts?.register(context.sessionID, deck.id, "flashcard", card)
        return composeCard(card, flashcardDockInstruction(deck.id, cards[0]!, 0, cards.length))
      }

      if (purpose === "quiz") {
        if (!args.quiz || args.quiz.length === 0) throw new Error('purpose "quiz" requires the `quiz` array (with `answer` per question)')
        const specs = normalizeAskQuestions(
          args.quiz.map((question) => ({
            header: question.header,
            question: question.question,
            options: question.options,
            multiple: question.multiple,
            custom: false,
          })),
          "quiz",
        )
        const accepted = args.quiz.map((question, index) => {
          const bound = bindAccepted(parseAccepted(question.answer), specs[index]!.options.map((option) => option.label))
          if (bound.length === 0) throw new Error(`quiz question ${index + 1} needs a non-empty answer`)
          return bound
        })
        const oneAtATime = args.oneAtATime ?? false
        const record: QuizRecord = {
          id: newUiId(),
          sessionID: context.sessionID,
          title: args.title,
          intro: args.intro,
          created: Date.now(),
          questions: specs.map((spec) => ({
            header: spec.header,
            question: spec.question,
            options: spec.options.map((option) => option.label),
            multiple: spec.multiple,
          })),
          accepted,
          explanations: args.quiz.map((question) => question.explanation),
          mode: oneAtATime ? "one" : "batch",
          next: 0,
          rows: [],
        }
        putState({ id: record.id, sessionID: context.sessionID, kind: "quiz", summary: quizSummary(record), created: record.created, payload: record })
        if (oneAtATime) {
          context.metadata({ title: `ui_ask · quiz q1/${specs.length}` })
          const card = renderAskCard({ specs: [specs[0]!], purpose, title: args.title, intro: args.intro, width })
          deps.parts?.register(context.sessionID, record.id, "quiz", card)
          return composeCard(card, questionCallInstruction([specs[0]!], { quizId: record.id, checkTool: "ui_quiz_check", questionIndex: 0 }))
        }
        context.metadata({ title: `ui_ask · quiz (${specs.length}q)` })
        const card = renderAskCard({ specs, purpose, title: args.title, intro: args.intro, width })
        deps.parts?.register(context.sessionID, record.id, "quiz", card)
        return composeCard(card, questionCallInstruction(specs, { quizId: record.id, checkTool: "ui_quiz_check" }))
      }

      if (!args.questions || args.questions.length === 0) throw new Error(`purpose "${purpose}" requires the \`questions\` array`)
      const specs = normalizeAskQuestions(args.questions, purpose)
      context.metadata({ title: `ui_ask · ${purpose} (${specs.length}q)` })
      const card = renderAskCard({ specs, purpose, title: args.title, intro: args.intro, width })
      return composeCard(card, questionCallInstruction(specs))
    },
  })
}
