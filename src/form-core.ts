import type { FormAnswerEntry, FormKind, FormQuestion, FormRecord } from "./state.ts"

export type FormInputQuestion = {
  header?: string
  question: string
  kind?: FormKind
  options?: (string | { label: string; description?: string })[]
  multiple?: boolean
  placeholder?: string
}

const KINDS: FormKind[] = ["text", "textarea", "radio", "checkbox", "select"]

export function normalizeFormQuestion(input: FormInputQuestion, index: number): FormQuestion {
  const where = `question ${index + 1}`
  const labels = (input.options ?? []).map((option) => (typeof option === "string" ? option : option.label))
  const descriptions = (input.options ?? []).map((option) =>
    typeof option === "string" ? undefined : option.description,
  )
  let kind: FormKind
  if (input.kind) {
    if (!KINDS.includes(input.kind)) {
      throw new Error(`smartui_form: ${where} has unknown kind "${input.kind}"`)
    }
    kind = input.kind
  } else {
    kind = labels.length > 0 ? (input.multiple ? "checkbox" : "radio") : "text"
  }
  if (kind === "radio" || kind === "checkbox" || kind === "select") {
    if (labels.length < 2) throw new Error(`smartui_form: ${where} (${kind}) needs at least 2 options`)
  } else if (labels.length > 0) {
    throw new Error(`smartui_form: ${where} is ${kind} — options are not allowed (use radio/checkbox/select for choices)`)
  }
  if (input.multiple && kind !== "checkbox") {
    throw new Error(`smartui_form: ${where} — multiple:true is only for checkbox questions`)
  }
  return {
    header: input.header,
    question: input.question,
    kind,
    options: labels,
    descriptions,
    placeholder: input.placeholder,
  }
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const STYLE_FORM =
  "max-width:560px;background:#1b1c1f;border:1px solid #33353a;border-radius:12px;padding:2px 18px 16px;font-family:inherit;font-size:13px;color:#e7e7ea;line-height:1.45"
const STYLE_EYEBROW = "display:block;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#2f7cf6;font-weight:700;margin:14px 0 0"
const STYLE_DIVIDER = "border:0;border-top:1px solid #2a2c31;margin:10px 0 0"
const STYLE_LEGEND = "font-weight:600;font-size:14px;padding:6px 0 0;color:#f2f2f5"
const STYLE_INTRO = "margin:6px 0 0;color:#a3a3ab"
const STYLE_FIELD = "display:block;margin:12px 0 0"
const STYLE_HEAD = "display:block;margin:0 0 5px;color:#c9c9cf"
const STYLE_INPUT =
  "width:100%;box-sizing:border-box;background:#121316;color:#ececf0;border:1px solid #3a3c42;border-radius:8px;padding:8px 10px;font-family:inherit;font-size:13px;accent-color:#2f7cf6"
const STYLE_CHOICE = "display:block;margin:3px 0;color:#d6d6db;cursor:pointer;accent-color:#2f7cf6"
const STYLE_DIM = "color:#8b8b93"
const STYLE_BUTTON =
  "margin-top:14px;background:#2f7cf6;color:#fff;border:0;border-radius:9px;padding:9px 18px;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit"

function fieldHead(question: FormQuestion, index: number): string {
  return `${index + 1}. ${question.header ? `${question.header}: ` : ""}${question.question}`
}

export function formCaption(record: FormRecord): string {
  const count = record.questions.length
  return `Form «${record.title ?? "quick form"}» — ${count} ${count === 1 ? "question" : "questions"} · fill in and press Send (answers arrive here automatically)`
}

export function submittedCaption(record: FormRecord): string {
  return `Form «${record.title ?? "quick form"}» — ✓ submitted`
}

const STYLE_RECEIPT =
  "max-width:560px;background:#1b1c1f;border:1px solid #33353a;border-radius:12px;padding:2px 18px 14px;font-family:inherit;font-size:13px;color:#e7e7ea;line-height:1.45"
const STYLE_RECEIPT_ROW = "display:flex;gap:12px;padding:7px 0;border-top:1px solid #26282d"
const STYLE_RECEIPT_LABEL = "color:#a3a3ab;min-width:150px"
const STYLE_RECEIPT_VALUE = "color:#f2f2f5"
const STYLE_RECEIPT_STAMP = "margin:12px 0 0;color:#8b8b93;font-size:11px"

function stampOf(record: FormRecord): string {
  const at = record.answers?.at
  if (!at) return "just now"
  return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`
}

export function submittedReceiptHtml(record: FormRecord): string {
  const entries = record.answers?.entries ?? []
  const lines: string[] = []
  lines.push(`<div style="${STYLE_RECEIPT}">`)
  lines.push(`<span style="${STYLE_EYEBROW}">✓ submitted</span>`)
  lines.push(`<div style="${STYLE_LEGEND}">${esc(record.title ?? "Quick form")}</div>`)
  lines.push(`<hr style="${STYLE_DIVIDER}">`)
  entries.forEach((entry, i) => {
    lines.push(
      `<div style="${STYLE_RECEIPT_ROW}"><span style="${STYLE_RECEIPT_LABEL}">${esc(entry.label)}</span><span style="${STYLE_RECEIPT_VALUE}">${esc(formatValues(record.questions[i]!, entry.values))}</span></div>`,
    )
  })
  lines.push(`<p style="${STYLE_RECEIPT_STAMP}">${esc(stampOf(record))} · answers arrived in the chat</p>`)
  lines.push(`</div>`)
  return lines.join("\n")
}

export function formHtml(record: FormRecord, actionUrl: string): string {
  const lines: string[] = []
  lines.push(`<form action="${esc(actionUrl)}" method="get" target="_blank" style="${STYLE_FORM}">`)
  lines.push(`<fieldset style="border:0;margin:0;padding:0">`)
  lines.push(`<span style="${STYLE_EYEBROW}">smartui form</span>`)
  lines.push(`<legend style="${STYLE_LEGEND}">${esc(record.title ?? "Quick form")}</legend>`)
  if (record.intro) lines.push(`<p style="${STYLE_INTRO}">${esc(record.intro)}</p>`)
  lines.push(`<hr style="${STYLE_DIVIDER}">`)
  record.questions.forEach((question, i) => {
    const name = `q${i + 1}`
    const head = esc(fieldHead(question, i))
    if (question.kind === "text" || question.kind === "textarea") {
      const placeholder = question.placeholder ? ` placeholder="${esc(question.placeholder)}"` : ""
      lines.push(`<label style="${STYLE_FIELD}"><span style="${STYLE_HEAD}">${head}</span>`)
      if (question.kind === "text") {
        lines.push(`<input type="text" name="${name}"${placeholder} style="${STYLE_INPUT}">`)
      } else {
        lines.push(`<textarea name="${name}" rows="3"${placeholder} style="${STYLE_INPUT}"></textarea>`)
      }
      lines.push(`</label>`)
      return
    }
    if (question.kind === "select") {
      lines.push(`<label style="${STYLE_FIELD}"><span style="${STYLE_HEAD}">${head}</span>`)
      lines.push(`<select name="${name}" style="${STYLE_INPUT}">`)
      question.options.forEach((option, j) => {
        const description = question.descriptions[j] ? ` — ${esc(question.descriptions[j]!)}` : ""
        lines.push(
          `<option value="${esc(option)}"${j === 0 ? " selected" : ""}>${esc(option)}${description}</option>`,
        )
      })
      lines.push(`</select></label>`)
      return
    }
    lines.push(`<div style="${STYLE_FIELD}"><span style="${STYLE_HEAD}">${head}</span>`)
    question.options.forEach((option, j) => {
      const description = question.descriptions[j]
      const checked = question.kind === "radio" && j === 0 ? " checked" : ""
      lines.push(
        `<label style="${STYLE_CHOICE}"><input type="${question.kind}" name="${name}" value="${esc(option)}"${checked}> ${esc(option)}${description ? ` <span style="${STYLE_DIM}">— ${esc(description)}</span>` : ""}</label>`,
      )
    })
    lines.push(`</div>`)
  })
  lines.push(`<button type="submit" style="${STYLE_BUTTON}">Send answers</button>`)
  lines.push(`</fieldset>`)
  lines.push(`</form>`)
  return lines.join("\n")
}

export function answersFromQuery(record: FormRecord, query: URLSearchParams): FormAnswerEntry[] {
  const byId = new Map<string, string[]>()
  for (const [rawKey, value] of query) {
    const key = rawKey.replace(/^user-content-/, "")
    const match = /^q(\d+)$/.exec(key)
    if (!match) continue
    const index = Number(match[1]) - 1
    if (index < 0 || index >= record.questions.length) continue
    const id = `q${index + 1}`
    const values = byId.get(id) ?? []
    const cleaned = value.trim()
    if (cleaned.length > 0) values.push(cleaned)
    byId.set(id, values)
  }
  return record.questions.map((question, i) => {
    const id = `q${i + 1}`
    return { id, label: question.header ?? question.question, values: byId.get(id) ?? [] }
  })
}

export function formatValues(question: FormQuestion, values: string[]): string {
  if (values.length === 0) return question.kind === "checkbox" ? "(none selected)" : "(left blank)"
  return values.join(", ")
}

export function submittedMessage(record: FormRecord): string {
  const entries = record.answers?.entries ?? []
  const lines = [`Form «${record.title ?? "quick form"}» submitted — answers from the embedded form:`]
  entries.forEach((entry, i) => {
    lines.push(`- ${entry.label}: ${formatValues(record.questions[i]!, entry.values)}`)
  })
  lines.push("", "Continue based on these answers.")
  return lines.join("\n")
}

export function confirmationPage(record: FormRecord, delivered: boolean): string {
  const entries = record.answers?.entries ?? []
  const list = entries
    .map(
      (entry, i) =>
        `<li style="margin:4px 0"><b style="color:#8ab4ff">${esc(entry.label)}</b>: ${esc(formatValues(record.questions[i]!, entry.values))}</li>`,
    )
    .join("")
  const footer = delivered
    ? `<p style="color:#8b8b93">This tab closes itself — otherwise just close it and go back to opencode.</p>`
    : `<p style="color:#fbbf24">Could not deliver automatically — go back to opencode and send any message, then ask to collect form ${esc(record.id)}.</p>`
  return [
    `<!doctype html><html><head><meta charset="utf-8"><title>Answers sent</title></head>`,
    `<body style="background:#141416;color:#e5e5e5;font-family:system-ui;padding:32px;max-width:640px">`,
    `<h2 style="color:#4ade80">✓ Answers ${delivered ? "delivered to opencode" : "saved"}</h2>`,
    `<p style="color:#a3a3ab">«${esc(record.title ?? "quick form")}»</p>`,
    `<ul style="list-style:none;padding:0">${list}</ul>`,
    footer,
    `<script>setTimeout(function(){try{window.close()}catch(e){}},900)</script>`,
    `</body></html>`,
  ].join("")
}

export function alreadySubmittedPage(): string {
  return [
    `<!doctype html><html><head><meta charset="utf-8"><title>Already submitted</title></head>`,
    `<body style="background:#141416;color:#e5e5e5;font-family:system-ui;padding:32px;max-width:640px">`,
    `<h2 style="color:#4ade80">✓ Already submitted</h2>`,
    `<p style="color:#8b8b93">These answers were already delivered to opencode.</p>`,
    `<script>setTimeout(function(){try{window.close()}catch(e){}},900)</script>`,
    `</body></html>`,
  ].join("")
}

export function expiredPage(): string {
  return [
    `<!doctype html><html><head><meta charset="utf-8"><title>Form not found</title></head>`,
    `<body style="background:#141416;color:#e5e5e5;font-family:system-ui;padding:32px;max-width:640px">`,
    `<h2 style="color:#fbbf24">Form not found</h2>`,
    `<p style="color:#8b8b93">This form expired or belongs to another session.</p>`,
    `</body></html>`,
  ].join("")
}
