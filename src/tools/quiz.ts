import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { nextStepInstruction } from "../dock.ts"
import {
  batchServeCardMarkdown,
  gradeQuestion,
  normalizeQuizQuestion,
  normalizeVotes,
  resultCardMarkdown,
  scoreQuiz,
  serveAllDockInput,
  serveCardMarkdown,
  serveDockInput,
  summaryCardMarkdown,
  type QuizInputQuestion,
} from "../quiz-core.ts"
import { dropQuiz, getQuiz, newId, putQuiz, type QuizRecord } from "../state.ts"

const S = tool.schema

const optionSchema = S.union([S.string(), S.object({ label: S.string(), description: S.string().optional() })])

const questionSchema = S.object({
  header: S.string().optional(),
  question: S.string(),
  options: S.array(optionSchema)
    .max(12)
    .optional()
    .describe("multiple-choice choices (2+); omit or pass [] for a fill-in question — the dock shows 'Type your own answer'"),
  answer: S.string().describe(
    "correct option label exactly as written in options; separate alternative accepted labels with |. With multiple:true list the complete required set separated by commas. For a fill-in question (no options) this is the accepted text, alternatives separated by | (matched case-insensitively, whitespace-normalized).",
  ),
  multiple: S.boolean().optional().describe("pick-all-that-apply; grading requires the exact full set; not allowed on fill-in questions"),
  explanation: S.string().optional().describe("shown when grading, right or wrong"),
})

const DESCRIPTION = [
  "Build and run questionnaires with the interactive question dock: create a quiz with questions + hidden answer keys, serve them, then grade the user's answers.",
  "Questions can be multiple-choice (`options` with 2+ choices) or fill-in (omit `options` — the dock shows 'Type your own answer'; `answer` holds accepted text alternatives separated by |).",
  "Create: pass `questions` (with `answer` per question). One-at-a-time: pass oneAtATime:true. The result serves question 1 (write the INLINE CARD first, then follow the ACTION section).",
  "Chat mode (`inline: true`): no dock — write the card, end your turn; the user answers in a normal chat message and you read the answers from it.",
  "Continue: after the dock returns answers (or, in chat mode, the user replies), call smartui_quiz again with the quizId and `answers` (pass the dock's answers through unchanged — labels or 1-based numbers). Batch mode grades everything at once; one-at-a-time mode grades the current question and serves the next.",
  "Never reveal answer keys or upcoming questions yourself; explanation text only appears in tool results after grading.",
].join(" ")

function requireQuiz(quizId: string, sessionID: string): QuizRecord {
  const record = getQuiz(quizId)
  if (!record || record.sessionID !== sessionID) {
    throw new Error(
      `smartui_quiz: unknown quizId "${quizId}" for this session — it may be finished already, or state expired (in-memory, 6h TTL)`,
    )
  }
  return record
}

const CHAT_CARD_HEADER =
  "INLINE CARD (chat mode) — write this block into the chat verbatim and exactly as-is, then END YOUR TURN and wait for the user's reply. Do NOT call the question tool."

function serveOne(record: QuizRecord, index: number, extraNote: string): string {
  if (record.inline) {
    return [
      `Question ${index + 1} of ${record.questions.length} served in chat.`,
      "",
      CHAT_CARD_HEADER,
      "",
      [serveCardMarkdown(record, index), "", "_Reply in chat — the label or its number._"].join("\n"),
      "",
      extraNote,
    ].join("\n")
  }
  return [
    `Question ${index + 1} of ${record.questions.length} served via the dock.`,
    "",
    "INLINE CARD — write this block into the chat first, verbatim and exactly as-is, then immediately execute the ACTION:",
    "",
    serveCardMarkdown(record, index),
    "",
    nextStepInstruction(serveDockInput(record, index)),
    "",
    extraNote,
  ].join("\n")
}

function serveAll(record: QuizRecord, extraNote: string): string {
  if (record.inline) {
    return [
      CHAT_CARD_HEADER,
      "",
      [batchServeCardMarkdown(record), "", "_Reply in chat — one answer per question, in order (labels or numbers)._"].join("\n"),
      "",
      extraNote,
    ].join("\n")
  }
  return [
    "INLINE CARD — write this block into the chat first, verbatim and exactly as-is, then execute the ACTION (one dock call with all questions):",
    "",
    batchServeCardMarkdown(record),
    "",
    nextStepInstruction(serveAllDockInput(record)),
    "",
    extraNote,
  ].join("\n")
}

function afterServeNote(record: QuizRecord, batch: boolean): string {
  if (record.inline) {
    return batch
      ? `After the user replies in chat, call smartui_quiz with quizId "${record.id}" and \`answers\` — one entry per question, in order, read from their message.`
      : `After the user replies in chat, call smartui_quiz with quizId "${record.id}" and \`answers\` read from their message.`
  }
  return batch
    ? `After the dock returns, call smartui_quiz with quizId "${record.id}" and \`answers\` — one entry per question, in order.`
    : `After the dock returns the user's answers, call smartui_quiz again with quizId "${record.id}" and \`answers\`.`
}

export function createQuizTool(): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      title: S.string().optional(),
      intro: S.string().optional(),
      inline: S.boolean().optional().describe("chat mode: no dock — write cards and wait for the user's typed replies in chat"),
      oneAtATime: S.boolean().optional().describe("serve and grade one question per dock turn"),
      questions: S.array(questionSchema).min(1).max(6).optional().describe("create mode: the quiz contents"),
      quizId: S.string().optional().describe("continue mode: id returned when the quiz was created"),
      questionIndex: S.number().int().min(0).max(5).optional().describe("one-at-a-time: 0-based index of the question being answered"),
      answers: S.array(S.union([S.string(), S.number(), S.array(S.union([S.string(), S.number()]))]))
        .optional()
        .describe("continue mode: the dock's answers — flat for one question, one entry per question for batch"),
    },
    async execute(args, context) {
      if (!args.quizId) {
        if (!args.questions || args.questions.length === 0) {
          throw new Error("smartui_quiz: provide `questions` to create a quiz, or `quizId` + `answers` to continue one")
        }
        const questions = args.questions.map((question, index) => normalizeQuizQuestion(question as QuizInputQuestion, index))
        const mode = args.oneAtATime === true ? "one" : "batch"
        const record: QuizRecord = {
          id: newId(),
          sessionID: context.sessionID,
          title: args.title,
          intro: args.intro,
          created: Date.now(),
          mode,
          inline: args.inline === true,
          questions,
          next: 0,
          results: questions.map(() => null),
        }
        putQuiz(record)
        context.metadata({ title: `smartui_quiz · ${questions.length}q${record.inline ? " · chat" : ""}` })
        if (mode === "one") return serveOne(record, 0, afterServeNote(record, false))
        return serveAll(record, afterServeNote(record, true))
      }

      const record = requireQuiz(args.quizId, context.sessionID)
      const total = record.questions.length
      const hasAnswers = Array.isArray(args.answers) && args.answers.length > 0

      if (!hasAnswers) {
        if (record.mode === "one") {
          const index = args.questionIndex ?? record.next
          if (index !== record.next) {
            throw new Error(
              `smartui_quiz: question ${index + 1} is out of order — the next unanswered question is ${record.next + 1}`,
            )
          }
          if (record.next >= total) {
            const { correct } = scoreQuiz(record)
            return [
              `The quiz is already finished (${correct}/${total} correct).`,
              "",
              "RELAY CARD — include this block verbatim in your reply:",
              "",
              summaryCardMarkdown(record),
            ].join("\n")
          }
          return serveOne(record, index, afterServeNote(record, false))
        }
        return serveAll(record, afterServeNote(record, true))
      }

      if (record.mode === "batch") {
        const entries = args.answers!
        if (entries.length !== total) {
          throw new Error(
            `smartui_quiz: expected ${total} answer entries (one per question, in order) — got ${entries.length}`,
          )
        }
        record.questions.forEach((question, index) => {
          if (record.results[index]) return
          const votes = normalizeVotes(entries[index])
          record.results[index] = gradeQuestion(question, votes)
        })
        record.next = total
        const summary = summaryCardMarkdown(record)
        dropQuiz(record.id)
        return [
          "The quiz is complete.",
          "",
          "RELAY CARD — include this block verbatim in your reply (do not add answer keys that are not in it):",
          "",
          summary,
        ].join("\n")
      }

      if (record.next >= total) {
        const { correct } = scoreQuiz(record)
        return [
          `The quiz is already finished (${correct}/${total} correct).`,
          "",
          "RELAY CARD — include this block verbatim in your reply:",
          "",
          summaryCardMarkdown(record),
        ].join("\n")
      }

      const index = args.questionIndex ?? record.next
      if (index !== record.next) {
        throw new Error(
          `smartui_quiz: question ${index + 1} is out of order — the next unanswered question is ${record.next + 1}`,
        )
      }
      const votes = normalizeVotes(args.answers)
      if (votes.length === 0) {
        throw new Error("smartui_quiz: no usable answers received — pass the dock's answers through unchanged")
      }
      record.results[index] = gradeQuestion(record.questions[index]!, votes)
      record.next = index + 1

      const result = resultCardMarkdown(record, index)
      if (record.next < total) {
        if (record.inline) {
          return [
            "RELAY CARDS — write the result card, then the next question card, verbatim and exactly as-is; then END YOUR TURN and wait for the user's reply. Do NOT call the question tool.",
            "",
            result,
            "",
            [serveCardMarkdown(record, record.next), "", "_Reply in chat — the label or its number._"].join("\n"),
            "",
            `After the user replies in chat, call smartui_quiz with quizId "${record.id}" again.`,
          ].join("\n")
        }
        return [
          "RELAY CARDS — write the result card, then the next question card, verbatim and exactly as-is; then immediately execute the ACTION:",
          "",
          result,
          "",
          serveCardMarkdown(record, record.next),
          "",
          nextStepInstruction(serveDockInput(record, record.next)),
          "",
          `After the dock returns the next answers, call smartui_quiz with quizId "${record.id}" again.`,
        ].join("\n")
      }
      const summary = summaryCardMarkdown(record)
      dropQuiz(record.id)
      return [
        "The quiz is complete.",
        "",
        "RELAY BLOCK 1 — include this block verbatim in your reply:",
        "",
        result,
        "",
        "RELAY BLOCK 2 — include this block verbatim right after block 1:",
        "",
        summary,
      ].join("\n")
    },
  })
}
