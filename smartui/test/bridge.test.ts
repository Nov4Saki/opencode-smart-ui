import { test } from "node:test"
import assert from "node:assert/strict"
import { applyPayload, createBridge, echoPlaceholder, markerPair } from "../src/bridge.ts"

test("applyPayload replaces the region between both markers", () => {
  const key = "abc123"
  const { start, end } = markerPair(key)
  const text = `before\n${start}\n_old_\n${end}\nafter`
  assert.equal(applyPayload(text, key, "PAYLOAD"), `before\n${start}\nPAYLOAD\n${end}\nafter`)
})

test("applyPayload rebuilds the pair from a single marker", () => {
  const key = "k12345"
  const { start, end } = markerPair(key)
  const text = `x\n${end}\ny`
  assert.equal(applyPayload(text, key, "P"), `x\n${start}\nP\n${end}\ny`)
})

test("applyPayload returns null without markers", () => {
  assert.equal(applyPayload("nothing here", "k12345", "p"), null)
})

test("applyPayload ignores other keys", () => {
  const text = echoPlaceholder("otherkey", "cap")
  assert.equal(applyPayload(text, "k12345", "p"), null)
})

test("applyPayload is idempotent", () => {
  const key = "abc123"
  const once = applyPayload(echoPlaceholder(key, "cap"), key, "PAYLOAD")!
  const twice = applyPayload(once, key, "PAYLOAD")!
  assert.equal(once, twice)
})

function fakeClient(partsByMessage: Record<string, { id: string; sessionID: string; messageID: string; type: string; text: string }[]>) {
  return {
    session: {
      message: async (input: { path: { id: string; messageID: string } }) => ({
        data: { parts: partsByMessage[input.path.messageID] ?? [] },
      }),
      messages: async (input: { path: { id: string } }) => ({
        data: Object.entries(partsByMessage)
          .filter(([, parts]) => parts.some((part) => part.sessionID === input.path.id))
          .map(([messageID, parts]) => ({ info: { id: messageID, role: "assistant" }, parts })),
      }),
    },
  } as never
}

test("bridge binds from observed text and patches on flush", async () => {
  const calls: { url: string; body: { text: string } }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    return new Response("{}", { status: 200 })
  }
  const echoed = `pre\n${echoPlaceholder("key12345", "cap")}\npost`
  const client = fakeClient({
    m1: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: echoed }],
  })
  const bridge = createBridge({ client, baseUrl: "http://127.0.0.1:9/", fetcher, env: {} })
  bridge.register("s1", "key12345", "![c](data:image/svg+xml;base64,AAAA)")
  bridge.observeText("s1", "m1", "p1", {}, echoed)
  await bridge.flushMessage("s1", "m1")
  assert.equal(calls.length, 1)
  assert.ok(calls[0]!.url.endsWith("/session/s1/message/m1/part/p1"))
  assert.ok(calls[0]!.body.text.includes("data:image/svg+xml"))
  assert.ok(calls[0]!.body.text.includes("key12345:start"))
  await bridge.flushMessage("s1", "m1")
  assert.equal(calls.length, 1, "already patched cards are not re-sent")
})

test("bridge scan fallback finds an unobserved card", async () => {
  const calls: string[] = []
  const fetcher: typeof fetch = async (input) => {
    calls.push(String(input))
    return new Response("{}", { status: 200 })
  }
  const echoed = `x\n${echoPlaceholder("key99999", "cap")}\ny`
  const client = fakeClient({
    m9: [{ id: "p9", sessionID: "s2", messageID: "m9", type: "text", text: echoed }],
  })
  const bridge = createBridge({ client, baseUrl: "http://127.0.0.1:9", fetcher, env: {} })
  bridge.register("s2", "key99999", "IMG")
  await bridge.flushSession("s2")
  assert.equal(calls.length, 1)
})

test("bridge gives up scanning after bounded attempts", async () => {
  let scans = 0
  const fetcher: typeof fetch = async () => {
    throw new Error("should never be called")
  }
  const client = {
    session: {
      message: async () => ({ data: { parts: [] } }),
      messages: async () => {
        scans += 1
        return { data: [] }
      },
    },
  } as never
  const bridge = createBridge({ client, baseUrl: "http://127.0.0.1:9", fetcher, env: {} })
  bridge.register("s3", "key00001", "IMG")
  await bridge.flushSession("s3")
  await bridge.flushSession("s3")
  await bridge.flushSession("s3")
  await bridge.flushSession("s3")
  assert.equal(scans, 3)
})

test("bridge posts a user message with auth headers", async () => {
  const calls: { url: string; method: string; body: unknown; auth?: string }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: String(init?.method),
      body: JSON.parse(String(init?.body)),
      auth: (init?.headers as Record<string, string> | undefined)?.authorization,
    })
    return new Response("{}", { status: 200 })
  }
  const bridge = createBridge({
    client: fakeClient({}),
    baseUrl: "http://127.0.0.1:9",
    fetcher,
    env: { OPENCODE_SERVER_PASSWORD: "speakfriend", OPENCODE_SERVER_USERNAME: "gandalf" },
  })
  const ok = await bridge.postUserMessage("s1", "Form «X» submitted — answers")
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.ok(calls[0]!.url.endsWith("/session/s1/message"))
  assert.equal(calls[0]!.method, "POST")
  assert.deepEqual(calls[0]!.body, { parts: [{ type: "text", text: "Form «X» submitted — answers" }] })
  assert.equal(calls[0]!.auth, `Basic ${Buffer.from("gandalf:speakfriend", "utf8").toString("base64")}`)
})

test("bridge updatePayload re-patches an already patched card in place", async () => {
  const calls: { url: string; body: { text: string } }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    return new Response("{}", { status: 200 })
  }
  const echoed = `pre\n${echoPlaceholder("key77777", "cap")}\npost`
  const client = fakeClient({
    m7: [{ id: "p7", sessionID: "s7", messageID: "m7", type: "text", text: echoed }],
  })
  const bridge = createBridge({ client, baseUrl: "http://127.0.0.1:9", fetcher, env: {} })
  bridge.register("s7", "key77777", "FORM")
  bridge.observeText("s7", "m7", "p7", {}, echoed)
  await bridge.flushMessage("s7", "m7")
  assert.equal(calls.length, 1)
  const receipt =
    '<div style="background:#1b1c1f">✓ submitted</div>\n<div style="display:flex"><span>Name</span><span>Nova</span></div>'
  const swapped = await bridge.updatePayload("s7", "key77777", receipt)
  assert.equal(swapped, true)
  assert.equal(calls.length, 2)
  assert.ok(calls[1]!.body.text.includes("✓ submitted"))
  assert.ok(calls[1]!.body.text.includes("Name</span><span>Nova"))
  assert.ok(!calls[1]!.body.text.includes("FORM"))
  const unchanged = await bridge.updatePayload("s7", "key77777", receipt)
  assert.equal(unchanged, false)
  assert.equal(calls.length, 2, "identical payloads are not re-sent")
})

test("bridge skips patch when payload is already present", async () => {
  let calls = 0
  const fetcher: typeof fetch = async () => {
    calls += 1
    return new Response("{}", { status: 200 })
  }
  const key = "key54321"
  const payload = "IMGPAYLOAD"
  const { start, end } = markerPair(key)
  const text = `${start}\n${payload}\n${end}`
  const client = fakeClient({
    m5: [{ id: "p5", sessionID: "s5", messageID: "m5", type: "text", text }],
  })
  const bridge = createBridge({ client, baseUrl: "http://127.0.0.1:9", fetcher, env: {} })
  bridge.register("s5", key, payload)
  bridge.observeText("s5", "m5", "p5", {}, text)
  await bridge.flushMessage("s5", "m5")
  assert.equal(calls, 0)
})

test("bridge bind marks the card patched and updatePayload still swaps in place", async () => {
  const calls: { url: string; body: { text: string } }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    return new Response("{}", { status: 200 })
  }
  const key = "key20202"
  const payload = "FORMHTML"
  const { start, end } = markerPair(key)
  const initial = `pre\n${start}\n${payload}\n${end}\npost`
  const client = fakeClient({
    m2: [{ id: "p2", sessionID: "s2b", messageID: "m2", type: "text", text: initial }],
  })
  const bridge = createBridge({ client, baseUrl: "http://127.0.0.1:9", fetcher, env: {} })
  bridge.register("s2b", key, payload)
  bridge.bind("s2b", key, { messageID: "m2", partID: "p2", text: initial })
  await bridge.flushMessage("s2b", "m2")
  assert.equal(calls.length, 0, "bound cards are already patched")
  const receipt = '<div style="background:#1b1c1f">✓ submitted</div>\n<div style="display:flex">Q: Radar</div>'
  const swapped = await bridge.updatePayload("s2b", key, receipt)
  assert.equal(swapped, true)
  assert.equal(calls.length, 1)
  assert.ok(calls[0]!.body.text.includes("✓ submitted"))
  assert.ok(calls[0]!.body.text.includes("Q: Radar"))
  assert.ok(!calls[0]!.body.text.includes(payload))
})

test("bridge patchPart sends a direct part patch with the provided part fields", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    return new Response("{}", { status: 200 })
  }
  const bridge = createBridge({ client: fakeClient({}), baseUrl: "http://127.0.0.1:9/", fetcher, env: {} })
  const ok = await bridge.patchPart("s9", "m9", "p9", "NEW TEXT", { extra: 1 })
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.ok(calls[0]!.url.endsWith("/session/s9/message/m9/part/p9"))
  assert.equal(calls[0]!.body.text, "NEW TEXT")
  assert.equal(calls[0]!.body.extra, 1)
  assert.equal(calls[0]!.body.type, "text")
  assert.equal(calls[0]!.body.sessionID, "s9")
})

test("bridge patchPart and fetchPartText degrade without a base url or part", async () => {
  const bridge = createBridge({
    client: fakeClient({}),
    fetcher: async () => {
      throw new Error("should never be called")
    },
    env: {},
  })
  assert.equal(await bridge.patchPart("s", "m", "p", "t"), false)
  assert.equal(await bridge.fetchPartText("s", "m", "p"), undefined)
})
