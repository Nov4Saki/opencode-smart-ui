# Smart-UI Plan: ChatGPT Parity for the Terminal

Research date: 2026-10-16. Sources: OpenAI Apps SDK docs (`developers.openai.com/plugins/*`, `apps-sdk-ui`), help center (study mode, data analysis), MCP Apps standard (`@modelcontextprotocol/ext-apps`).

Goal: take everything that makes ChatGPT's "smart UI" work — architecture, interaction contracts, design rules, visual catalogue — and turn it into a concrete, correct implementation plan for `opencode-smart-ui` (already shipping: `ui_render`, `ui_ask`, `ui_quiz_check`, 9 chart kinds, 8 widget kinds).

---

## 1. How ChatGPT does it (research summary)

### 1.1 Three layers

| Layer | What it is | Terminal analogue (ours) |
| --- | --- | --- |
| **Model-native rich text** | Markdown tables, mermaid diagrams, interactive tables, charts from code interpreter (bar/line/pie/scatter interactive; others static images), study-mode quizzes | fenced ```text art echoed by the model; `question` dock for input |
| **Apps / MCP Apps widgets** | iframe UI linked to a tool via `_meta.ui.resourceUri`, hydrated by `structuredContent`, bridged by JSON-RPC over `postMessage` | plugin tool output (plain text card) + in-memory plugin state |
| **Conversation patterns** | follow-up chips, suggested prompts, one-question-at-a-time quizzing, forms, confirmations | `suggest` element + TUI prefill, `ui_ask` → `question` dock |

### 1.2 Architectural principles worth stealing (verified against Apps SDK docs)

1. **Data tools ≠ render tools.** Apps SDK explicitly warns that attaching a template to every tool causes re-render storms; the pattern is: data/compute tools return `structuredContent`, and a dedicated *render tool* owns the template. Our `ui_render` is the render tool; the model computes data first. → Prompt the model to batch data prep, call `ui_render` once with final numbers, never loop-re-render.
2. **`structuredContent` vs `_meta`.** Model sees `structuredContent` + `content`; `_meta` reaches only the widget. Terminal equivalent: everything in tool output is model-visible → *truly hidden state only lives in plugin memory* (exactly what we do for quiz answer keys). Generalize this (section 5).
3. **`widgetState` / `modelContent`.** Widgets persist short state (`setWidgetState`) and inject only a concise `modelContent` string into the model's context on later turns — not the whole UI. Terminal equivalent: keep a per-session UI-state registry and inject *one summary line* via `experimental.chat.system.transform` (we already own that hook).
4. **Display modes = progressive disclosure.** Inline (default, always before the model response) → fullscreen (rich tasks) → PiP (stays relevant across turns). Terminal: fenced card inline; "expand on request" = the model re-renders detail when asked (cheaper: add `detail` args to elements); PiP ≈ `toast` side channel.
5. **Tool use must degrade gracefully.** Tools stay useful without UI. Ours are pure text — model can always read values from `data` args. Keep `summary` lines in every art block.
6. **`outputSchema` discipline.** Apps SDK requires declared output schemas and concise structured data ("keep fields concise; the model reads them verbatim"). Ours: keep tool output small; art goes in a fence, data stays in args.
7. **Status copy.** `openai/toolInvocation/invoking|invoked` ("Searching…" / "Searched") — we use `context.metadata({title})` per call; extend to per-element counts.

### 1.3 Design rules to enforce (from UI guidelines)

- Cards: **≤ 2 actions** (1 primary), one decision per card, no tabs/drill-ins, no nested scrolling, no duplicating inputs the host already provides.
- Carousels: 3–8 items, always a visual, title, ≤ 2 lines metadata, one CTA per item, consistent hierarchy.
- Follow-up model text: short, **not redundant with the card**.
- Branding: host owns chrome (icon + app name above the widget); content avoids re-stating the frame.
- Visual: system colors only, monochrome outlined icons, WCAG AA contrast, text resizing without breakage.
- Accessibility: alt text everywhere, don't encode meaning in color alone.

Terminal translations of these rules (add to our system prompt + renderer lint, section 6):
- ≤ 2 "actions" per card = ≤ 2 suggest items or 1 question block + 1 CTA line.
- No card-in-card nesting, no second drill-down; split into sequential tool calls (that's also the Apps SDK guidance).
- Truncation must be explicit ("… +12 more rows") — the terminal's nested-scroll ban.

### 1.4 Component kit (Apps SDK UI, for mapping)

`Alert · Avatar · Badge · Button · Checkbox · CodeBlock · DatePicker · DateRangePicker · EmptyMessage · Icon · Image · Indicator · Input · Markdown · Menu · Popover · RadioGroup · SegmentedControl · Select · SelectControl · ShimmerText · Slider · Switch · TagInput · TextLink · Textarea · Tooltip · Transition`

Most are form controls — ours live in the `question` dock (Input/Select/RadioGroup/Checkbox/Switch/Slider→number input). What we can add as *visual* elements: Alert variants (`callout` ✓), Badge row, CodeBlock (with diff), DatePicker (calendar heatmap), EmptyMessage, Indicator (status dot row), Timeline, Stepper, KV/properties list, Tooltip (footnotes).

### 1.5 Study mode's quiz UX (target behavior)

- One question at a time, wait for answer, feedback per answer, explain why right/wrong, offer next review.
- Flashcard-style review is a first-class flow.
- Socratic mode: hints before answers.
   Our quiz already does batch questions + grading + explanations. Gap: **one-question-at-a-time mode**, **flashcards**, **hints**, **self-rated review scheduling**.

---

## 2. Gap analysis: our plugin vs ChatGPT

| Capability | ChatGPT | Ours today | Action |
| --- | --- | --- | --- |
| bar / column / line / area / scatter / donut / histogram / sparkline / heatmap | ✓ (+interactive for bar/line/pie/scatter) | ✓ | keep |
| grouped / stacked bars | via code interpreter | ✗ | **add** |
| pie (explicit) | ✓ | donut covers | alias `pie` → donut w/ hole 0 |
| box plot, violin | static images | ✗ | **add box plot**; violin = skip (P3) |
| gauge / bullet / ratio | dashboards | ✗ | **add gauge + bullet** |
| waterfall / funnel | common in DA charts | ✗ | **add both** |
| timeline / gantt | static images | ✗ | **add timeline, gantt (P2)** |
| calendar heatmap | ✓ | heatmap covers w/ rows | **add calendar variant** |
| network / DAG | rare | ✗ | **P2 stretch** |
| interactive tables | ✓ (sort/filter/click) | plain table ✓ | terminal: top-N + `maxColWidth` + row numbers; add truncation note |
| KPI cards / stats | ✓ | ✓ | keep |
| checklist / progress | ✓ | ✓ | keep |
| callout/alert | ✓ | ✓ | keep (+`EmptyMessage` style) |
| follow-up chips | ✓ | `suggest` + prefill | keep; refine rules |
| forms | ✓ | `ui_ask form` → dock | keep |
| menu/select | ✓ | `ui_ask menu` | keep |
| quizzes | study mode | `ui_ask quiz` + `ui_quiz_check` | extend: 1-at-a-time, hints, flashcards |
| confirmations | ✓ | `ui_ask menu` yes/no | document pattern |
| code block w/ diff | ✓ | ✗ | **add `diff` element** |
| hidden state / answer keys | `_meta` | in-memory quiz store | **generalize store** |
| state → model context | `widgetState.modelContent` | ✗ | **add via system.transform** |
| status titles | invoking/invoked | `context.metadata` title | keep |

---

## 3. Visualization specs (the "what" and the correct "how")

Shared conventions for every new element:
- Pure function `renderX(input, ctx)` → `string[]`; no I/O; all lines ≤ `ctx.width`; ≥ 1 content line; numeric args that are NaN/Infinity are dropped and if nothing remains → throw `Error` with actionable text.
- Number formatting via `formatNumber` (k/M/B, ≤ 2 decimals, comma grouping); percentages 0–1 fractions with `formatPct`.
- Shade ladder ` ░▒▓█`; structure glyphs `─│├┤┌┐└┘┬┴┼ ╭╮╰╯ ▸ ● ○ ✔ ✖ ⚠ ℹ ✦ ⊘ ∅`; ASCII fallback not required (TUI users have UTF-8).
- Every element gets an optional `caption?: string` and auto-`summary` line where meaning relies on shade/position (accessibility rule: don't encode meaning only in shade).
- `legend` lines: `glyph name value`; multi-series uses texture ladder `█ ▓ ▒ ░` + line styles `─── ╌╌╌ ┈┈┈` (existing).

### 3.1 Stacked / grouped columns (`chart: "column"` + `stacked: true`; new `chart: "grouped-column"`)

Input: `series: [{name, values}]`, optional `percent: true` (100% stacked).
- **Grouped**: `stride = S*(w) + (w-1)` subcell math on the existing Raster: each series gets sub-column range `[s*w2, (s+1)*w2)`; one legend entry per series; shared baseline.
- **Stacked**: per column, cumulative sums; render each segment's subcell range `[mapY(base+value), mapY(base)]`; texture per series index (`█▓▒░` cycled); if `percent`, normalize per column then the y-axis is 0–100% with mid label `50%`.
- Correctness: segments < 1 subcell must still render ≥ 1 subcell (min-height), otherwise small values vanish; keep totals readable by capping series at 4 (throw beyond, suggest two charts). Test: sum of stacked heights == column height for all-positive data.

### 3.2 Box plot (`chart: "box"`) — horizontal

Input: `series: [{name, values}]` (raw samples). Compute Q1/Q2/Q3 by linear interpolation (numpy/pandas default: `idx = q*(n-1)`).
- Layout per row: `name ┤ ├───[▓▓▓▓│▓▓▓]───┤` where whiskers = min/max (or 1.5·IQR fences, default `whiskers: "minmax" | "tukey"`), box = Q1..Q3 filled `▓`, median `│` (double-struck: use `┃`), outliers `×` beyond fences.
- Axis tick line at bottom with min/mid/max values. Min width guard: scale range must map [lo,hi] onto `plotWidth`, lo==hi → single `│` marker + label.
- Test: quartile math vs known arrays; whisker caps present; width invariant.

### 3.3 Gauge (`chart: "gauge"`)

Input: `value`, `max`, optional `min`, `bands: [{upTo, label}]`, `unit`.
- 240° arc sweep (start at −210° from top, end at +30°), radius from `width`; needle: radial line via `Raster.line` from center at `angle = start + frac*sweep`; center label = value; tick marks every 10%, labels at min/mid/max only.
- Bands: shade the annulus per band (`░▒▓`) *behind* the needle ink — render bands first, needle overwrites. If `frac > 1`, clamp ink + append `▲ over max`.
- Correctness: no needle for missing value (throw); arc gap check leaves clean ends (same `circularDistance` guard as donut).

### 3.4 Bullet (`chart: "bullet"`)

Input: `items: [{label, value, target?, max?, ranges?}]`. Per row: value bar `█`, comparative target marker `╿` (vertical dashed) at target position, qualitative ranges as background `░` bands (0–60/60–90/90–100 default thirds). Layout `label ┤████████████╿     │ 72/100`. One line per item, 1–6 items. Correctness: target marker always 1 cell, drawn over the bar (`╿` replaces bar cell); clamp both to [0,max].

### 3.5 Waterfall (`chart: "waterfall"`)

Input: `data: [{label, value, type?: "abs"|"delta"|"total"}]`.
- Running total; `abs` sets level, `delta` floats from prev→next, `total` full-height snapshot. Deltas: increase `█`, decrease `▒` (minus sign always in label — shade alone is not the signal). Connector dashes `┄` from the top of bar i to the start of bar i+1 (one subcell line). Y labels at lo/mid/hi; per-step value labels above bars.
- Correctness: NaN gaps → skip column keeping index alignment; if all zero, render baseline + labels.

### 3.6 Funnel (`chart: "funnel"`)

Input: `data: [{label, value}]` ordered; centered horizontal bars with width ∝ value/max, min 1; right column: value + step conversion `%` vs previous; center-align via `padCenter`; suffix `stage 3/5`. Correctness: zero-stage → still row with `∅`; conversion uses previous non-zero.

### 3.7 Timeline (`chart: "timeline"`)

Input rows `[{time, label, detail?, status?: "done"|"active"|"todo"|"error"}]`.
- Vertical rail: `│` spine, `●`/`◉`/`○`/`✖` nodes, time gutter right-aligned width = max(time labels) capped 12, detail wrapped with hanging indent. Horizontal variant when `layout:"horizontal"` and width ≥ 60: staggered labels above/below a `├─●──●─┤` rail (odd/even rows) to prevent collisions; drop labels that would overlap (both neighbors present → skip, add `…` at rail end).
- Correctness: monotonic time not required; render in input order; tie times get `└` branch ticks.

### 3.8 Calendar heatmap (`heatmap` variant `rows: "calendar"` or new `chart: "calendar"`)

Input: `{ weeks: [[v,…7]…] }` or `data: [{date: "YYYY-MM-DD", value}]`.
- 7 rows (Mon–Sun), shade ` ░▒▓█` by quantile buckets (terciles for ≤3 nonzero? use fixed 4 buckets by max) + month labels row aligned to week columns (label at first week where month appears; skip if < 3 cells room).
- **TZ correctness**: parse `YYYY-MM-DD` by slicing (`year,month,day`), compute weekday via `Date.UTC(y, m-1, d)` — never local Date parsing.
- Test: known calendar binning; month label positions; DST independence (UTC math).

### 3.9 Gantt (`chart: "gantt"`) — P2

Input: `tasks: [{label, start, end, group?, status?}]`, `range?: [start,end] | auto`.
- Label gutter + track; bar `█` span, rounded ends via `▏▕` half blocks at fraction edges; group rows bold-less (blank line); `today` marker `┊` when date provided; duration text right.
- Correctness: clamp bars to range; start==end → 1-cell marker; overlapping rows independent.

### 3.10 DAG / dependency graph (`chart: "dag"`) — P2 stretch

Input: `nodes: [{id,label}], edges: [{from,to}]` (ids human-short).
- Layout: layer = longest path from source (Kahn topsort); order within layer by barycenter of parents (2 sweeps); node box = `[label]` fixed per-layer column width; edges routed in gutters with orthogonal segments (`─│┌┐└┘├┤┬┴`) drawn on a second Raster overlay behind node cells; crossing count not optimized beyond barycenter.
- Caps: ≤ 12 nodes / 20 edges → else throw with advice to split. Deterministic tie-breaking (stable sort by id).
- Correctness: cycles → detect, throw "cycle detected: A → B → A"; self-edges ignored.

### 3.11 Diff (`diff` element)

Input: `hunks: [{header: "@@ -12,4 +12,6 @@", lines: [{type: "ctx"|"add"|"del", text}]}]` or raw unified `patch` string (parse).
- Gutter right-aligned old/new line numbers, prefix `+ `/`− `/`  `; `␣` visible-space not needed; long lines wrapped with continuation `↩` marker; file header line `── path ──`.
- Semantics without color: prefix chars carry the signal (WCAG-safe); optional `showWhitespace`.
- Correctness: parse failures → throw with line number; cap hunks (… more).

### 3.12 Small elements (all P1, cheap)

- **`kv` / properties**: `label ⋯ value` with dot leaders (min 2 dots), values optionally right-aligned; max label width 24; used in summaries/details.
- **`badge` row**: `▸ name·value` chips wrapped by width (2-line max) — the terminal Badge/Indicator.
- **`stepper`**: `①─②─③` with `✔ ● ○ ✖` states + optional title; wizard progress.
- **`empty`**: `∅ {message}` in a 1-line callout (EmptyMessage analog).
- **`footnotes`**: `¹` markers + footnote block `¹ text…` (Tooltip analog) — renderer wraps text; referenced inline marks are the model's job to place in prose.
- **`quote`**: `│ ` prefix block with attribution line (cheap, high usage).
- **`spinner`-ish status**: NOT rendered statically — use `metadata({title})` + toast; do not fake animation in art.

---

## 4. Interaction specs (chat surfaces)

### 4.1 One-question-at-a-time quiz (study-mode parity)

Extend `ui_ask quiz` with `oneAtATime: true`:
- Plugin asks only Q1 via `question` dock, grades on `ui_quiz_check` (which now accepts `questionIndex`), returns feedback card + "next" suggest chip (`prefill: Continue quiz`, calling `ui_quiz_check` next round only after the user answers? *Simpler correct flow*: model re-calls `ui_ask quiz` with `quizId`+`questionIndex+1` → plugin renders next question using stored key; final call triggers summary.
- State: `{id, order, next, perQuestionResults}` in store; one-at-a-time sessions survive multiple turns via the UI-state summary injection (4.4).
- Prompts: forbid revealing future questions/answers; feedback = explanation + hint-on-miss then continue.

### 4.2 Flashcards

`ui_ask quiz` mode `flashcards: true`:
- Dock offers `Reveal answer | Skip`; a new `ui_reveal` (or `ui_quiz_check` variant) renders the answer card + self-rating menu (`Again · Hard · Good · Easy`) via a second dock; store interval (SM-2-lite: doubles on Good/Easy, resets on Again) per card id within session; end-of-session summary stats.

### 4.3 Confirm & destructive patterns

Document + steer: destructive op → `ui_render` callout `warning/error` + `ui_ask menu` with `Run it · Cancel` (`custom:false`), never free-text. No dedicated tool needed; add examples to prompts.

### 4.4 UI-state → model context (widgetState parity)

`state.ts` becomes a session-scoped registry:
- `put/get/drop(kind, id)` with `{sessionID, kind: "quiz"|"wizard"|"flashcard"|"view", summary: string, created}`; cap 64/session; one-shot kinds dropped on completion.
- `experimental.chat.system.transform` appends at most 2 lines: `pending UI state: quiz abc123 q2/5 unanswered; wizard deploy step 3/4` — concise, model-actionable, mirrors `modelContent`.
- Never inject hidden answer keys.

### 4.5 Follow-up chips (refinement of `suggest`)

- Enforce guidelines in renderer: ≤ 3 items (carousel rule 3–8 → terminal cards are tighter), every item needs `prompt` (the CTA), label ≤ 24, description ≤ 1 line; when `prefill` is used, exactly one `↳ prefilled` annotation.
- New: `suggest` after-chips auto-appended by *model* is fine; plugin does not spam chips on its own.

---

## 5. Correctness standards (cross-cutting)

1. **Width invariant** — already enforced in `renderElement` (fence, trim, truncate); extend tests to property-style: every renderer output for 40/56/72/100 cols and degenerate inputs has `∀line displayWidth ≤ width` and at least one line.
2. **Grapheme-safe text** — replace code-unit slicing in `truncate`/`wrapText`/`padX` with `Intl.Segmenter("en", {granularity: "grapheme"})` walking clusters (emoji ZWJ, flags, combining marks). Node ≥ 24 has it; guard fallback to code-point iteration.
3. **Glyph allowlist test** — collect all chars from every element render across a fixture corpus; assert membership in a documented allowlist (blocks, box drawing, shade, arrows, approved symbols). Catches accidental CJK/fullwidth mix-ins that break alignment.
4. **Determinism** — no `Date.now()`/random in renderers (ids only in tools); golden-file snapshots under `test/golden/*.txt` compared byte-for-byte (avoid experimental `t.assert.snapshot`).
5. **Height budget** — new `limitHeight(lines, max=42, note="… +N more lines")`; charts heights clamp as today; tool outputs stay < ~12 KB so the model can echo them.
6. **Number discipline** — assert `formatNumber` on all numeric displays (test scans for raw floats in golden files: `/\d+\.\d{3,}/`).
7. **Error UX** — every thrown message names the offending field and the fix; never partial renders (validate → render); tool-level catch adds element index (exists).
8. **Accessibility** — each chart gets `title` + units + a `summary` line; shade never sole carrier (pair with glyph/number); callouts have text labels (`warning:` etc. in title row).
9. **Performance** — O(plot cells) ≤ ~72×14 subcell ops per element; table ≤ 50 rows rendered + note; no O(n²) string builds (use arrays + join).
10. **Preview + golden discipline** — `npm run preview` remains the eyeball gate; every new element lands with preview sample + golden test + width property case.

---

## 6. Steering & prompt updates

Add to `SYSTEM_PROMPT` (mirroring Apps SDK rules):
- "Compute all data first; call `ui_render` once with final values. Never re-render to 'update' a previous card — render a new one only when data changed."
- "Card rules: one decision per card, ≤ 2 suggested actions, no nested lists of navigation, truncate with '… +N more' instead of shrinking text below 40 cols."
- "Follow-up text: one short, non-redundant line after the block (no restating the table rows)."
- "Quizzes: never reveal answers; one-question-at-a-time when the user asks to be quizzed."
- "Destructive actions: callout + confirm menu; free-text only for `form`."

Tool description updates: `ui_render` gains examples of the new chart kinds (models copy patterns from descriptions); `ui_quiz_check` documents `questionIndex`/one-at-a-time.

---

## 7. Roadmap (ordered, with acceptance criteria)

**M1 — chart depth (L)**
Stacked/grouped columns (+percent), box plot, gauge, bullet, waterfall, funnel, calendar heatmap.
Accept: each has schema + renderer + golden + preview + width property test; total preview runtime < 2 s; stacked-heights invariant test passes.

**M2 — structure & text elements (M)**
`diff` (parse unified + structured), `kv`, `badge`, `stepper`, `empty`, `quote`, `footnotes`; graphviz-grade `dag` deferred.
Accept: diff parser tests (rename hunks, no-newline marker, malformed input); golden files; allowlist test covers new glyphs.

**M3 — interaction depth (L)**
One-question-at-a-time quiz, flashcards with SM-2-lite, UI-state registry + `system.transform` summary injection, quiz check answering by index, study-session summary card (`stats` + `checklist`).
Accept: multi-turn-flow integration tests with fake contexts; state TTL + cap tests; no answer leakage (test asserts keys absent from all model-visible strings).

**M4 — hardening (M)**
Grapheme segmenter, golden snapshots in CI, glyph allowlist test, height limiter, prompt refinements, README/docs gallery with real previews.
Accept: full suite green on Node 24; preview at 40/72/100 cols visually checked; docs updated.

**Non-goals**: true color/ANSI themes; mouse/hover; streaming animation inside a card; ASCII-image rendering; arbitrary HTML/markdown in art (markdown stays the model's job); nested navigation widgets.

---

## Appendix: ChatGPT → our mapping (quick reference)

| ChatGPT surface | Ours |
| --- | --- |
| inline card before response | fenced ```text block echoed by model |
| carousel | `table`/`stats` columns; `suggest` chips |
| fullscreen | model re-renders richer version on request (`detail` arg) |
| PiP | `toast` |
| template + structuredContent | tool args (input) + art (render) |
| `_meta` (widget-only) | plugin memory (`state.ts`), never in output |
| `widgetState.modelContent` | `system.transform` state summary line |
| `sendFollowUpMessage` | `suggest` + `tui.appendPrompt` (+ optional submit) |
| `callTool` from widget | `question` dock delegation + `ui_quiz_check` |
| `requestCheckout`/modal | `ui_ask form` / confirm menu |
| invoking/invoked strings | `context.metadata({title})` + toasts |
| display mode negotiation | fixed: inline text + dock + prefill (terminal reality) |
