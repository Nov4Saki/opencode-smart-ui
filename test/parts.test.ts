import assert from "node:assert/strict"
import { test } from "node:test"
import { artProbes, authHeader, createPartBridge, swapFence } from "../src/parts.ts"

const ART_A = ["Chart one", "â”Œâ”€â”€â”€â”", "â”‚ a â”‚", "â””â”€â”€â”€â”˜"]
const ART_B = ["Chart two", "â”Œâ”€â”€â”€â”", "â”‚ b â”‚", "â””â”€â”€â”€â”˜"]
const fenceOf = (art: string[]) => ["```text", ...art, "```"].join("\n")

test("artProbes uses the first and last two substantive lines", () => {
  const probes = artProbes(["", "one", "two", "three", "four", "", "five"])
  assert.equal(probes.sigA, "one\ntwo")
  assert.equal(probes.sigB, "four\nfive")
  const single = artProbes(["only"])
  assert.equal(single.sigA, "only")
  assert.equal(single.sigB, "only")
  assert.deepEqual(artProbes(["", "  "]), { sigA: "", sigB: "" })
})

test("swapFence replaces only the fence containing both probes", () => {
  const text = ["Intro", fenceOf(ART_A), "middle", fenceOf(ART_B), "outro"].join("\n")
  const probes = artProbes(ART_A)
  const swapped = swapFence(text, probes.sigA, probes.sigB, ["new"])
  assert.ok(swapped)
  assert.ok(swapped!.includes(fenceOf(["new"])))
  assert.ok(swapped!.includes(fenceOf(ART_B)), "the other fence is untouched")
  assert.ok(swapped!.startsWith("Intro"))
  assert.ok(swapped!.endsWith("outro"))
  assert.equal(swapFence(text, "nope", "nada", ["x"]), null)
})

test("swapFence handles CRLF text", () => {
  const text = ["Intro", fenceOf(ART_A), "outro"].join("\r\n")
  const probes = artProbes(ART_A)
  const swapped = swapFence(text, probes.sigA, probes.sigB, ["new-a"])
  assert.ok(swapped)
  assert.ok(swapped!.includes("```text\r\nnew-a\r\n```"))
})

test("authHeader builds basic auth only when a password is present", () => {
  assert.equal(authHeader({}), undefined)
  assert.equal(authHeader({ OPENCODE_SERVER_PASSWORD: "pw" }), "Basic " + Buffer.from("opencode:pw").toString("base64"))
  assert.equal(
    authHeader({ OPENCODE_SERVER_PASSWORD: "pw", OPENCODE_SERVER_USERNAME: "me" }),
    "Basic " + Buffer.from("me:pw").toString("base64"),
  )
})

function fakeMessageClient(initialText: string, fail = false) {
  const state = { text: initialText, calls: 0 }
  const client = {
    session: {
      message: async () => {
        state.calls += 1
        if (fail) throw new Error("refetch failed")
        return { data: { parts: [{ id: "prt_1", sessionID: "s1", messageID: "m1", type: "text", text: state.text }] } }
      },
      messages: async () => ({ data: [] }),
    },
  }
  return { state, client }
}

function fakeFetcher(ok = true) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return { ok } as Response
  }
  return { calls, fetcher }
}

test("bridge binds an echoed part, patches it, and re-targets after the swap", async () => {
  const echoed = ["Here you go:", fenceOf(ART_A), "Enjoy!"].join("\n")
  const { state, client } = fakeMessageClient(echoed)
  const { calls, fetcher } = fakeFetcher()
  const bridge = createPartBridge({
    client: client as never,
    baseUrl: "http://127.0.0.1:9/",
    fetcher: fetcher as never,
    env: { OPENCODE_SERVER_PASSWORD: "pw" },
    retry: { attempts: 1 },
  })

  bridge.register("s1", "card1", "render", ART_A)
  assert.equal(bridge.has("s1", "card1"), true)
  const part = { id: "prt_1", sessionID: "s1", messageID: "m1", type: "text", text: echoed }
  assert.equal(bridge.bindFromText("s1", "m1", "prt_1", part, echoed), true)
  assert.equal(bridge.bindFromText("s2", "m1", "prt_1", part, echoed), false, "other sessions do not bind")

  assert.equal(await bridge.patch("s1", "card1", ART_B), true)
  assert.equal(calls.length, 1)
  assert.ok(calls[0]!.url.startsWith("http://127.0.0.1:9/session/s1/message/m1/part/prt_1"))
  const body = JSON.parse(String(calls[0]!.init.body)) as { text: string; id: string; type: string }
  assert.equal(body.id, "prt_1")
  assert.equal(body.type, "text")
  assert.ok(body.text.includes(fenceOf(ART_B)))
  assert.ok(!body.text.includes("â”‚ a â”‚\nâ””â”€â”€â”€â”˜"), "the old art is gone")
  assert.ok(body.text.startsWith("Here you go:"))
  assert.ok(body.text.endsWith("Enjoy!"))
  const headers = calls[0]!.init.headers as Record<string, string>
  assert.equal(headers.authorization, "Basic " + Buffer.from("opencode:pw").toString("base64"))

  state.text = body.text
  assert.equal(await bridge.patch("s1", "card1", ART_A), true, "second patch finds the swapped fence via updated probes")
  assert.equal(calls.length, 2)
})

test("bridge refuses to patch unbound or missing cards and unbinds removed parts", async () => {
  const { client } = fakeMessageClient("x")
  const { calls, fetcher } = fakeFetcher()
  const bridge = createPartBridge({ client: client as never, baseUrl: "http://x", fetcher: fetcher as never, env: {}, retry: { attempts: 1 } })
  bridge.register("s1", "card1", "render", ART_A)
  assert.equal(await bridge.patch("s1", "card1", ART_B), false)
  assert.equal(await bridge.patch("s1", "unknown", ART_B), false)
  assert.equal(calls.length, 0)

  const text = fenceOf(ART_A)
  const part = { id: "prt_9", sessionID: "s1", messageID: "m9", type: "text", text }
  bridge.bindFromText("s1", "m9", "prt_9", part, text)
  assert.equal(bridge.bindFromText("s1", "m9", "prt_9", part, text), false, "already-bound cards ignore later echoes")
  bridge.removePart("m9", "prt_9")
  assert.equal(await bridge.patch("s1", "card1", ART_B), false, "removed parts cannot be patched")
})

test("bridge falls back to the echoed snapshot when the message refetch fails", async () => {
  const echoed = ["Intro", fenceOf(ART_A), "Tail after the fence"].join("\n")
  const { client } = fakeMessageClient(echoed, true)
  const { calls, fetcher } = fakeFetcher()
  const bridge = createPartBridge({ client: client as never, baseUrl: "http://x", fetcher: fetcher as never, env: {}, retry: { attempts: 1 } })
  bridge.register("s1", "card1", "render", ART_A)
  const part = { id: "prt_1", sessionID: "s1", messageID: "m1", type: "text", text: echoed }
  bridge.bindFromText("s1", "m1", "prt_1", part, echoed)
  assert.equal(await bridge.patch("s1", "card1", ART_B), true)
  const body = JSON.parse(String(calls[0]!.init.body)) as { text: string }
  assert.ok(body.text.endsWith("Tail after the fence"))
})

test("bridge leaves probes untouched when the PATCH fails, then recovers", async () => {
  const echoed = fenceOf(ART_A)
  const { client } = fakeMessageClient(echoed)
  let ok = false
  const calls: { url: string }[] = []
  const fetcher = async (url: string | URL | Request) => {
    calls.push({ url: String(url) })
    return { ok } as Response
  }
  const bridge = createPartBridge({ client: client as never, baseUrl: "http://x", fetcher: fetcher as never, env: {}, retry: { attempts: 1 } })
  bridge.register("s1", "card1", "render", ART_A)
  bridge.bindFromText("s1", "m1", "prt_1", { id: "prt_1", sessionID: "s1", messageID: "m1", type: "text", text: echoed }, echoed)
  assert.equal(await bridge.patch("s1", "card1", ART_B), false)
  ok = true
  assert.equal(await bridge.patch("s1", "card1", ART_B), true, "retry still finds the original fence")
})

test("bridge patches a late-streaming echo by scanning the session messages", async () => {
  const fenceText = fenceOf(ART_A)
  let flushed = false
  const client = {
    session: {
      message: async () => ({ data: { parts: [] } }),
      messages: async () => ({
        data: [
          {
            info: { id: "m1", role: "assistant" },
            parts: [
              {
                id: "prt_1",
                sessionID: "s1",
                messageID: "m1",
                type: "text",
                text: flushed ? fenceText : "",
              },
            ],
          },
        ],
      }),
    },
  }
  const { calls, fetcher } = fakeFetcher()
  const bridge = createPartBridge({
    client: client as never,
    baseUrl: "http://x",
    fetcher: fetcher as never,
    env: {},
    retry: { attempts: 4, delayMs: 10 },
  })
  bridge.register("s1", "card1", "render", ART_A)
  setTimeout(() => {
    flushed = true
  }, 5)
  assert.equal(await bridge.patch("s1", "card1", ART_B), true, "late echo is found by the retry scan")
  const body = JSON.parse(String(calls[0]!.init.body)) as { text: string }
  assert.ok(body.text.includes(fenceOf(ART_B)))
})

test("bridge tracks the latest render card per session and drops cleanly", () => {
  const bridge = createPartBridge({ client: {} as never })
  assert.equal(bridge.latestRender("s1"), undefined)
  bridge.markLatestRender("s1", "r1")
  bridge.markLatestRender("s1", "r2")
  assert.equal(bridge.latestRender("s1"), "r2")
  bridge.register("s1", "r2", "render", ART_A)
  assert.equal(bridge.has("s1", "r2"), true)
  bridge.drop("s1", "r2")
  assert.equal(bridge.has("s1", "r2"), false)
})
