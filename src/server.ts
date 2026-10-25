import { createServer, type Server } from "node:http"
import { debugLog } from "./bridge.ts"
import { CHART_TTL_MS, MAX_CHARTS, type ChartStore } from "./chart-store.ts"

export { CHART_TTL_MS }

export type FormSubmitResult = { status: number; html: string }

export type ChartServerOptions = {
  onFormSubmit?: (key: string, query: URLSearchParams) => Promise<FormSubmitResult>
  store?: ChartStore
}

export type ChartPublisher = {
  publish(key: string, svg: string): Promise<string | undefined>
  formUrl(key: string): Promise<string | undefined>
  close(): Promise<void>
}

function randomToken(): string {
  return `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
}

export function createChartServer(options: ChartServerOptions = {}): ChartPublisher {
  const store = options.store
  const identity = store?.loadIdentity()
  const token = identity?.token ?? randomToken()
  const preferredPort = identity?.port
  const charts = new Map<string, { svg: string; created: number }>()
  let server: Server | undefined
  let starting: Promise<string | undefined> | undefined
  let base: string | undefined

  function prune(now = Date.now()): void {
    for (const [key, entry] of charts) {
      if (now - entry.created > CHART_TTL_MS) charts.delete(key)
    }
    while (charts.size > MAX_CHARTS) {
      const oldest = [...charts.entries()].sort((a, b) => a[1].created - b[1].created)[0]
      if (!oldest) break
      charts.delete(oldest[0])
    }
    try {
      store?.prune(now)
    } catch (error) {
      debugLog(`chart-store-error ${String(error)}`)
    }
  }

  const notFound = (response: import("node:http").ServerResponse): void => {
    response.writeHead(404, { "content-type": "text/plain" })
    response.end("not found")
  }

  const handle = async (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    const formMatch = /^\/f\/([a-z0-9]+)\/([a-z0-9]+)$/.exec(url.pathname)
    if (formMatch) {
      if (formMatch[1] !== token || !options.onFormSubmit) {
        notFound(response)
        return
      }
      try {
        const result = await options.onFormSubmit(formMatch[2]!, url.searchParams)
        response.writeHead(result.status, { "content-type": "text/html; charset=utf-8" })
        response.end(result.html)
      } catch (error) {
        debugLog(`form-route-error ${String(error)}`)
        response.writeHead(500, { "content-type": "text/plain" })
        response.end("form handler error")
      }
      return
    }
    const match = /^\/c\/([a-z0-9]+)\/([a-z0-9]+)\.svg$/.exec(url.pathname)
    if (!match || match[1] !== token) {
      notFound(response)
      return
    }
    let entry = charts.get(match[2]!)
    if (!entry && store) {
      const fromDisk = store.readChart(match[2]!)
      if (fromDisk) {
        entry = fromDisk
        charts.set(match[2]!, fromDisk)
      }
    }
    if (!entry) {
      notFound(response)
      return
    }
    response.writeHead(200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, max-age=86400",
      "content-length": Buffer.byteLength(entry.svg),
    })
    response.end(entry.svg)
  }

  function tryListen(port: number): Promise<{ server: Server; port: number } | undefined> {
    return new Promise((resolve) => {
      const httpServer = createServer((request, response) => {
        void handle(request, response)
      })
      httpServer.once("error", (error) => {
        debugLog(`chart-server-error ${String(error)}`)
        resolve(undefined)
      })
      httpServer.listen(port, "127.0.0.1", () => {
        const address = httpServer.address()
        if (!address || typeof address === "string") {
          httpServer.close()
          resolve(undefined)
          return
        }
        httpServer.on("error", (error) => {
          debugLog(`chart-server-error ${String(error)}`)
        })
        resolve({ server: httpServer, port: address.port })
      })
    })
  }

  async function start(): Promise<string | undefined> {
    if (base) return base
    if (starting) return starting
    starting = (async () => {
      const ports = preferredPort === undefined ? [0] : [preferredPort, 0]
      for (const port of ports) {
        const attempt = await tryListen(port)
        if (!attempt) continue
        server = attempt.server
        base = `http://127.0.0.1:${attempt.port}`
        prune()
        if (store) {
          try {
            store.saveIdentity({ token, port: attempt.port })
          } catch (error) {
            debugLog(`chart-store-error ${String(error)}`)
          }
        }
        const fallback = port === 0 && preferredPort !== undefined ? " (port fallback)" : ""
        debugLog(`chart-server ${base}${fallback}`)
        return base
      }
      return undefined
    })()
    return starting
  }

  return {
    async publish(key, svg) {
      const origin = await start()
      if (!origin) {
        starting = undefined
        return undefined
      }
      prune()
      charts.set(key, { svg, created: Date.now() })
      try {
        store?.writeChart(key, svg)
      } catch (error) {
        debugLog(`chart-store-error ${String(error)}`)
      }
      return `${origin}/c/${token}/${key}.svg`
    },
    async formUrl(key) {
      const origin = await start()
      if (!origin) {
        starting = undefined
        return undefined
      }
      return `${origin}/f/${token}/${key}`
    },
    async close() {
      server?.close()
      server = undefined
      base = undefined
      starting = undefined
      charts.clear()
    },
  }
}
