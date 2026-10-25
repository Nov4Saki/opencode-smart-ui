# opencode-smartui

Smart UI elements for the opencode desktop chat: SVG charts, structured panels, interactive menus, graded questionnaires and embedded HTML forms — rendered in the conversation.

Works on the v1 plugin API (`@opencode-ai/plugin` 1.14.x / desktop 1.19.x).

## Visual blocks (text, no tool calls)

Charts, panels and forms are plain fenced JSON blocks the model writes straight into its reply — no tool call, no schema, no echo round-trip. When the assistant message completes the plugin parses each fence and PATCHes the text part in place:

````markdown
```smartui-show
{"element":"column","title":"Builds","labels":["Mon","Tue"],"series":[{"values":[3,7]}]}
```

```smartui-form
{"title":"Launch survey","questions":[{"header":"Name","question":"What is your name?"}]}
```
````

- `smartui-show` — one chart (`bar`, `column`, `line`, `area`, `donut`, `sparkline`, `gauge`, `scatter`, `waterfall`, `heatmap`, `radar`, `timeline`, `funnel`, `progress`, `treemap`) or panel (`stats`, `kv`, `table`, `checklist`, `callout`, `badges`, `quote`). Chart natively-rendered SVG images are served from the local chart server; on the `art` surface (or when the server is down) charts degrade to unicode art in a code fence. Panels are plain markdown. Scatter points accept `"alpha"` and `"radius"`, and a scatter past 20k points is stride-sampled down with a corner count note and a lighter default fade (vector-only, no raster).
- `smartui-form` — a real HTML form (text, textarea, radio, checkbox, select — up to 8 questions). The user fills it in place and presses Send; answers arrive automatically as a new user message and the form region swaps to a "✓ submitted" receipt card listing the captured answers. A malformed block is replaced with a one-line error note instead of failing the turn.

### Data input

Chart data can be inline JSON, compact shorthand, or read from a project file:

- **Inline JSON** — the full shape, e.g. `"series":[{"name":"North","values":[12,15,9]}]`.
- **Compact shorthand** — `"labels":"Q1,Q2,Q3"`, `"values":"1 2 3"`, `"data":"A:3, B:7"`, `"spans":"design:0:4; build:3:9"`.
- **`source`** — `"source":"reports/revenue.csv"` (`.csv`, `.tsv` or `.json`, resolved against the project directory then the workspace root, 2 MB / 2000-row cap — scatter is allowed 16 MB / 300k rows and is sampled to 20k dots, or an absolute path). The element then names its columns instead of holding the numbers: bar/donut/waterfall/funnel/treemap use `"label"`+`"value"`; column/line/area/radar use `"labels"`+`"series"`; scatter uses `"x"`+`"y"` (+ optional `"group"`); heatmap uses `"row"`+`"column"`+`"value"`; timeline uses `"label"`+`"start"`+`"end"`; progress uses `"value"`. Column refs may be a column name or a 0-based index. Generate the file with your own tools first — nothing executes inside a block.

## Tools

| Tool | Purpose |
|---|---|
| `smartui_ask` | Ask the user — a menu or form whose choice decides what happens next. Questions are multiple-choice (`options`) or fill-in (omit `options`). Dock mode (default) uses the built-in question dock; chat mode (`inline: true`) skips the dock and the user answers with a normal message. |
| `smartui_quiz` | Stateful questionnaire: server-side answer keys, batch or one-question-at-a-time, grading with explanations and a summary table. Supports multiple-choice and fill-in questions (`answer` alternates separated by `|`). |
| `smartui_form` | Collect-only recovery tool: fetches the answers of a pending form (by `key`) if the user says the automatic submission did not arrive. |

## How rendering works

`opencode` v1 does not render custom tool output, so everything visible is delivered through server-side PATCHes of the assistant's text parts:

1. The model writes `smartui-show` / `smartui-form` fences as ordinary reply text.
2. On `message.part.updated` the plugin stashes parts that contain a fence; when the message completes (or the session goes idle) it re-fetches the final part text, parses the fences and PATCHes the part once:
   - shows are replaced by the rendered payload (chart `<img>` markdown or panel markdown) directly;
    - forms are replaced by marker-wrapped HTML (`<!--smartui:<key>:start--> … <!--smartui:<key>:end-->`) and the card is registered and bound, so the later submitted-receipt swap can find the region again.
3. Image charts point at the plugin's local chart server (`http://127.0.0.1:<port>/c/<token>/<key>.svg`), which serves the SVG for 6h. The chart server is also what makes chart keys usable. Chart SVGs and the server identity (token + port) are persisted to disk (`chart-server.json` + `charts/` under the plugin data dir: `%LOCALAPPDATA%\opencode-smartui` on Windows, `$XDG_DATA_HOME/opencode-smartui` elsewhere, override with `SMARTUI_DATA_DIR`) so chart images in past messages keep loading after an app restart; expired files are pruned on the same 6h TTL. Form records are persisted the same way (`forms/`, one small JSON per form): after a restart, form cards in past messages can still be submitted and the receipt swap still works. Writes are best-effort, reads are lazy (single small file on submit, no startup scan), and the same 6h TTL plus a 256-record cap keeps disk use bounded.

The question dock and quiz relay the built-in `question` tool — the question card is written into the chat first (INLINE CARD), so the questions render inline above the dock while the user answers. With `inline: true` (chat mode) there is no dock at all: the card carries a "Reply in chat" hint and the user answers by typing, which keeps the transcript free of the native question block.

`smartui-form` embeds **real HTML** (`<form>`), which the desktop renderer passes through sanitized (DOMPurify keeps `form`/`input`/`select`/`button`, strips scripts, and prefixes `id`/`name` with `user-content-`).

Form capture has two transports:

- **In-app log bridge (default).** The form's `action` is `xmpp://<key>` with `target="_blank"`. The desktop's sanitizer keeps only allowlisted schemes (`http/https/ftp/tel/mailto/callto/sms/cid/xmpp/matrix`) in URL attributes — a custom scheme would be silently stripped — and `xmpp:` is one of the few the desktop's external-URL policy blocks. The `target="_blank"` submit lands in `setWindowOpenHandler` → `openExternalURL`, which denies the window and writes a `blocked external target` warn line — full URL including the answers — into its `electron-log` run directory (`<userData>/logs/<run>/window.log`). The plugin tails that file, parses the query back out, POSTs the answers to the session as a user message, and re-patches the form region down to a "✓ submitted" caption. No browser tab and no navigation ever happens.
- **HTTP fallback.** If the log directory can't be resolved (unknown app layout/OS), the form's `action` points at the plugin's local server (`/f/<token>/<key>`) instead; a `GET` submission opens a brief local confirmation tab — the platform's only network channel for form data — and the same pipeline runs. Force either with `SMARTUI_FORM_TRANSPORT=log|http` and override the logs root with `SMARTUI_FORM_LOG_ROOT`.

## Options

Plugin options (second tuple element in `opencode.jsonc`):

```jsonc
["<path>/smartui/src/index.ts", { "surface": "image", "injectPrompt": true }]
```

- `surface` — `"image"` (default) renders charts as vector SVG images served from a tiny local HTTP server; `"art"` emits compact unicode-art in a code fence. If the chart server cannot start, charts fall back to art automatically.
- `injectPrompt` — set `false` to skip the system-prompt guidance.

## Dev

```powershell
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (Node >= 22, uses type stripping)
```

Set `SMARTUI_DEBUG=1` to log bridge activity to `%TEMP%\smartui-debug.log`.

## Layout

```
src/
  index.ts        plugin entry (tools + event hooks + system prompt injection)
  block-core.ts   fence scanning/parsing, block rendering, one-shot part PATCH
  bridge.ts       marker protocol: bind on part events, PATCH on completion, message injection
  show-core.ts    chart/panel rendering (element registry, hydration, source loading)
  data-source.ts  CSV/TSV/JSON dataset loading + column helpers
  server.ts       local chart + form server (127.0.0.1, persisted port + token paths, disk-backed charts)
  chart-store.ts  on-disk chart SVG + server identity persistence (6h TTL, 256 cap)
  form-store.ts   on-disk form record persistence + memory-first reload (6h TTL, 256 cap)
  dock.ts         question-dock JSON relay
  quiz-core.ts    question normalization, grading, card rendering
  form-core.ts    form normalization, HTML rendering, submitted receipt, query capture, pages
  log-transport.ts desktop electron-log tailing (blocked-target capture)
  state.ts        in-memory quiz + form store (6h TTL, 32/session)
  options.ts      plugin options
  prompts.ts      injected system prompt
  tools/          ask.ts, quiz.ts, form.ts (collect-only)
  svg/            core.ts, charts.ts, panels.ts, payload.ts
  art/            fallback.ts (unicode charts)
test/             node:test suites
```
