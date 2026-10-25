import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { questionSpecFrom, renderAskCard } from "../ask-core.ts"
import type { PartBridge } from "../parts.ts"
import { dropState, getState, putState } from "../state.ts"
import { gradeQuestion, gradeQuiz, quizSummary, renderGrading, renderQuestionFeedback, renderQuizSummary, resultFromRows, type QuizRecord, type QuizRow } from "../quiz-core.ts"
import { clamp } from "../render/util.ts"

const S = tool.schema

const answerSchema = S.union([S.string(), S.number()])

function rowMark(row: QuizRow): string {
  if (row.correct) return "✓ correct"
  const you = row.selected.length > 0 ? `you: ${row.selected.join(", ")} · ` : ""
  return `✗ wrong — ${you}answer: ${row.accepted.join(" or ") || "(no key)"}`
}

const DESCRIPTION = [
  "Grade a quiz started with ui_ask (purpose \"quiz\"). Batch quizzes: pass the quizId and answers, one array per question in order.",
  "One-at-a-time quizzes: pass the quizId plus questionIndex and the answers for that question; feedback for that question returns and the next question is served by calling ui_ask with the next questionIndex. The final question returns a study summary.",
  "Answers hold the chosen option label(s) exactly as returned by the question dock, or the 1-based option number. Returns fenced ```text art to include verbatim in your reply, followed by one short natural line. Each quiz question can only be graded once; never reveal answers yourself.",
].join(" ")

export function createQuizCheckTool(deps: { width: number; parts?: PartBridge }): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      quizId: S.string(),
      questionIndex: S.number().int().min(0).optional().describe("one-at-a-time quiz: 0-based index of the question being answered"),
      answers: S.union([S.array(answerSchema), S.array(S.array(answerSchema))]),
      width: S.number().int().min(40).max(120).optional(),
    },
    async execute(args, context) {
      const record = getState(args.quizId)
      if (!record || record.sessionID !== context.sessionID || record.kind !== "quiz") {
        throw new Error(`unknown quizId "${args.quizId}" — it may have been graded already or belongs to another session`)
      }
      const quiz = record.payload as QuizRecord
      const width = clamp(args.width ?? deps.width, 40, 120)
      const rawAnswers = args.answers as (string | number)[] | (string | number)[][]
      const grouped = Array.isArray(rawAnswers[0]) ? (rawAnswers as (string | number)[][]) : [rawAnswers as (string | number)[]]

      const resolve = (index: number, selections: (string | number)[]): string[] =>
        selections.map((selection) => {
          if (typeof selection !== "number") return selection
          const label = quiz.questions[index]?.options[selection - 1]
          if (!label) {
            throw new Error(`answer ${selection} is out of range for question ${index + 1} (1-based, has ${quiz.questions[index]?.options.length ?? 0} options)`)
          }
          return label
        })

      if (quiz.mode === "one") {
        const index = args.questionIndex ?? quiz.next
        if (index !== quiz.next) {
          throw new Error(`questionIndex ${index} is out of order — question ${quiz.next + 1} is the next unanswered one`)
        }
        const row = gradeQuestion(quiz.questions[index]!, quiz.accepted[index] ?? [], resolve(index, grouped[0] ?? []), quiz.explanations[index])
        quiz.rows[index] = row
        quiz.next = index + 1
        if (quiz.next < quiz.questions.length) {
          putState({ ...record, summary: quizSummary(quiz), payload: quiz })
          if (deps.parts) {
            const marked = renderAskCard({
              specs: [questionSpecFrom(quiz.questions[index]!)],
              purpose: "quiz",
              title: quiz.title,
              intro: quiz.intro,
              width,
              status: [rowMark(row)],
            })
            await deps.parts.patch(context.sessionID, quiz.id, marked)
          }
          context.metadata({ title: `ui_quiz_check · q${index + 1} ${row.correct ? "correct" : "wrong"}` })
          const lines = renderQuestionFeedback(quiz, row, index, width)
          return [
            "```text",
            ...lines,
            "```",
            "",
            "Include exactly the fenced ```text block above verbatim in your markdown reply.",
            "",
            `NEXT STEP — required: call \`ui_ask\` with purpose "quiz", quizId "${quiz.id}" and questionIndex ${quiz.next} to serve question ${quiz.next + 1}. Never reveal future questions or answers.`,
          ].join("\n")
        }
        if (deps.parts) {
          const marked = renderAskCard({
            specs: [questionSpecFrom(quiz.questions[index]!)],
            purpose: "quiz",
            title: quiz.title,
            intro: quiz.intro,
            width,
            status: [rowMark(row)],
          })
          const summaryLines = renderQuizSummary(quiz, quiz.rows, width)
          await deps.parts.patch(context.sessionID, quiz.id, [...marked, "", ...summaryLines])
          deps.parts.drop(context.sessionID, quiz.id)
        }
        dropState(quiz.id)
        context.metadata({ title: `ui_quiz_check · final ${resultFromRows(quiz.rows).score}/${quiz.questions.length}` })
        const feedback = renderQuestionFeedback(quiz, row, index, width)
        const summary = renderQuizSummary(quiz, quiz.rows, width)
        return [
          "```text",
          ...feedback,
          "```",
          "",
          "```text",
          ...summary,
          "```",
          "",
          "The quiz is complete — include both fenced ```text blocks above verbatim in your markdown reply, in order, then add one short, warm closing line (highlight what to review, or offer another round).",
        ].join("\n")
      }

      if (args.questionIndex !== undefined) throw new Error(`quiz "${quiz.id}" is a batch quiz — grade it with all answers in one call`)
      const answers = grouped.map((selections, index) => resolve(index, selections))
      const result = gradeQuiz(quiz, answers)
      if (deps.parts) {
        const marked = renderAskCard({
          specs: quiz.questions.map(questionSpecFrom),
          purpose: "quiz",
          title: quiz.title,
          intro: quiz.intro,
          width,
          status: result.rows.map(rowMark),
        })
        await deps.parts.patch(context.sessionID, quiz.id, marked)
        deps.parts.drop(context.sessionID, quiz.id)
      }
      dropState(quiz.id)
      context.metadata({ title: `ui_quiz_check · ${result.score}/${result.total}` })
      const lines = renderGrading(quiz, result, width)
      return [
        "```text",
        ...lines,
        "```",
        "",
        "Include exactly the fenced ```text block above verbatim in your markdown reply, then add one short follow-up line (encouragement, a pointer to what to review, or an offer of a rematch). Keep it natural, not robotic.",
      ].join("\n")
    },
  })
}
