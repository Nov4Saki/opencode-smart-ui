# opencode-smart-ui

ChatGPT-style smart chat UI for [opencode](https://opencode.ai): let the model render **charts, stat dashboards, tables, checklists, callouts, trees, diffs, next-step prompts, interactive menus, one-question-at-a-time quizzes, and spaced-repetition flashcard decks** directly in the conversation.

The model calls four tools (`ui_render`, `ui_ask`, `ui_quiz_check`, `ui_reveal`); the plugin renders terminal art and the model echoes it into its reply.

```text
Bundle size by package (kB)
react-dom        █████████████████████████████▉                    130.2
@opencode-ai/sdk █████████████████████████████████████████████████ 212.8
lodash           ████████████████▌                                  71.4
zod              █████████████▏                                     57.1
```

## Gallery

Real output from `npm run preview` (72 cols):

```text
Working tree changes
── src/tools/render.ts ─────────────────────────────────────────────────
@@ -18,3 +18,6 @@ const pointSchema = S.object({
 18  18     label: S.string().optional(),
 19     -   value: S.number(),
     19 +   value: S.number(),
     20 +   type: S.enum(["abs", "delta", "total"]).optional(),
 20  21   })
          ⊘ no newline at end of file
```

```text
Warm-up — summary
┌───────────┐ ┌───────────┐ ┌───────────┐
│ Score     │ │ Accuracy  │ │ Missed    │
│ 4/5       │ │ 80%       │ │ 1         │
└───────────┘ └───────────┘ └───────────┘

Question review
✔ Q1 · What does the TUI appendPrompt call do?
✔ Q2 · When must the model echo the fenced block?
✖ Q3 · Which element renders dot leaders?
✔ Q4 · What width invariant does renderElement enforce?
✔ Q5 · Which hook injects pending UI state?
[███████████████████▎    ] 80% complete
```

## Install

Requires opencode v1 (tested with 1.14.46).

From npm — add the package to your config and opencode installs it on next start:

```jsonc
// ~/.config/opencode/opencode.jsonc (global) or .opencode/opencode.jsonc (project)
{
  "plugin": ["opencode-smart-ui"]
}
```

Or reference a local checkout directly:

```jsonc
{
  "plugin": [
    ["/abs/path/to/opencode_plugin/src/index.ts", { "width": 72 }]
  ]
}
```

Options (second tuple element, optional):

| option         | default | meaning                                      |
| -------------- | ------- | -------------------------------------------- |
| `width`        | `72`    | art width in columns (40–120); per-call override via tool args |
| `injectPrompt` | `true`  | inject usage guidance into the system prompt |

## Try it

Ask the model things like:

- "Render a bar chart of this repo's file types by count" (`ui_render`)
- "Start a 5-question quiz on the JavaScript event loop" (`ui_ask` → native question dock → `ui_quiz_check`)
- "Flashcards for Spanish irregular verbs, 5 cards" (deck → `ui_reveal`, SM-2-lite scheduling)
- "Refresh that chart with Q2 numbers" (`ui_render update:true` — updates the card in place where the host supports part edits)

## Tools

### `ui_render` — static visuals

Pass `elements: [...]` (or a single `element`). Element types:

| type        | what                                                                 |
| ----------- | -------------------------------------------------------------------- |
| `chart`     | `bar`, `column` (stacked/grouped/percent), `line`, `area`, `scatter`, `donut`, `histogram`, `sparkline`, `heatmap`, `box`, `gauge`, `bullet`, `waterfall`, `funnel`, `calendar` |
| `stats`     | KPI cards with delta/trend arrows and hints                           |
| `table`     | aligned grid with per-column alignment                                |
| `checklist` | todo/doing/done/blocked/skipped items + progress bar                  |
| `callout`   | info/success/warning/error/tip framed box                             |
| `tree`      | file/outline trees with right-aligned notes                           |
| `suggest`   | numbered next-step prompts; can prefill one into the input box        |
| `divider`   | full-width rule, optionally labeled                                   |
| `diff`      | unified patch or structured hunks with line numbers, wrapping, whitespace marks |
| `kv`        | label/value rows with dot leaders                                     |
| `badge`     | compact status chips (info/ok/warn/bad), two-line wrap                |
| `stepper`   | ordered steps with done/active/todo/error states, vertical fallback   |
| `empty`     | one-line empty state with optional hint                               |
| `quote`     | `│ ` block with optional attribution                                  |
| `footnotes` | superscript markers with hanging-indent bodies                        |

Chart data can be `data: [{label, value}]`, `values: [..]`, `series: [{name, values}]` (line/area/scatter/box), `rows: [{label, values}]` (heatmap), `items` (gauge/bullet/funnel), or date labels (calendar).

Side effects (TUI only, silently skipped in headless runs):
- `prefill: n` — put suggest item `n`'s prompt into the user's input box
- `autoSubmit: true` — also submit it
- `toast: {message, variant}` — show a TUI toast

### `ui_ask` — interactive dock

`purpose: "menu" | "form" | "quiz"`, plus `questions` (menu/form) or `quiz` (quiz, with `answer` key and optional `explanation` per question). The plugin renders a card and instructs the model to call opencode's built-in `question` tool with exact JSON, so the user answers in the native TUI question dock.

- **One-at-a-time quizzes**: `oneAtATime: true` serves question 1 only; later calls pass `quizId` + `questionIndex` to serve the stored next question. Answers never carry accepted keys — the question payload stays leak-free.
- **Flashcards**: `flashcards: true` + `cards: [{front, back, hint?}]` starts a study deck. The dock offers Reveal/Skip; `ui_reveal` drives reveal → self-rating (Again/Hard/Good/Easy) → next card, and ends with a session summary. Scheduling is SM-2-lite: Good/Easy double the interval, Hard keeps it, Again resets to 1 day.

### `ui_quiz_check` — grading

Grades a quiz started with `ui_ask`. Batch quizzes take all answers in one call; one-at-a-time quizzes take `questionIndex` plus that question's answers and return per-question feedback (the final question returns a study summary: stats + per-question checklist). Answers may be option labels or 1-based option numbers. Answer keys support alternatives (`"5173 | vite's default"`) and select-all questions (`multiple: true`). The quizId burns after grading.

### `ui_reveal` — flashcard driver

Reveals the back of the current card (`deckId` + `cardIndex`), or advances the deck with a `rating` (`again`/`hard`/`good`/`easy`) or `action: "skip"`. The last card returns a session summary with intervals.

## In-place card updates

When the host supports message-part edits (the opencode desktop app and `opencode serve` do), cards update **in the conversation itself** instead of being re-posted:

- `ui_render` accepts `update: true` to re-render the most recent card of the session in place — use it for chart refreshes and live dashboards.
- Flashcard decks flip in place: the same card window shows front → back → next → session summary.
- Quiz cards get graded in place: `ui_quiz_check` marks each question right/wrong on the original card.

How it works: echoed card art is bound to its message part (by matching the first/last lines of the art against streamed parts, with a scan fallback), then the part is `PATCH`ed via `PATCH /session/{id}/message/{messageID}/part/{partID}`. When the mechanism is unavailable, the plugin falls back to classic echoed fences — behavior and tool payloads are identical either way. Set `SMARTUI_DEBUG=1` to log binding/patching decisions to `smartui-debug.log` in the OS temp dir.

## How the model is steered

Tool output contains a fenced ` ```text ` block plus an explicit instruction to include it verbatim in the reply (plugin tool output is not rendered automatically by the TUI). With `injectPrompt` enabled, a short system-prompt section tells the model when to reach for visuals and to keep restraint.

While a quiz or flashcard deck is mid-flight, the plugin appends one `pending UI state:` line to the system prompt for that session so the model resumes the right flow across turns. Records are session-scoped, capped at 64 per session, and expire after 6 hours.

## Development

```sh
npm install
npm run typecheck
npm test          # node --test (Node >= 23 for TS type stripping); includes byte-for-byte golden snapshots
npm run preview   # prints every element type at 72 cols (pass a width to override)
```

Source layout: `src/render/` pure art renderers (no opencode deps, unit-testable), `src/*-core.ts` pure logic, `src/tools/` tool definitions, `src/index.ts` plugin entry.
