import assert from "node:assert/strict"

import { POST } from "../src/app/api/images/route"
import { executeImageStudioRequestStrategy } from "../src/lib/image-studio-generation"

type RouteResult = {
  debug?: {
    request?: {
      endpoint?: string
    }
  }
  endpoint?: string
  error?: string
  images: Array<{ src: string }>
}

type UpstreamCall = {
  files: Array<{
    key: string
    name: string
    type: string
  }>
  textFields: Record<string, string[]>
  url: string
}

type UpstreamOutcome =
  | {
      imageCount: number
      ok: true
    }
  | {
      errorMessage: string
      ok: false
      status?: number
    }

const EDITS_ENDPOINT = "https://api.openai.com/v1/images/edits"
const PROMPT = "route strategy integration prompt"
const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b5mQAAAAASUVORK5CYII="

type CallImageStudioProxy = (options: {
  apiKey: string
  background: string
  endpoint: string
  imageCount: number
  images: File[]
  locale: string
  model: string
  outputFormat: string
  prompt: string
  quality: string
  signal?: AbortSignal
  size: string
  timeoutMs: number
}) => Promise<RouteResult>

function createInputImage() {
  return new File(["abc"], "reference.png", { type: "image/png" })
}

function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  })
}

function snapshotFormData(url: string, formData: FormData): UpstreamCall {
  const textFields: Record<string, string[]> = {}
  const files: UpstreamCall["files"] = []

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      textFields[key] = [...(textFields[key] || []), value]
      continue
    }

    files.push({
      key,
      name: value.name,
      type: value.type,
    })
  }

  return { files, textFields, url }
}

function assertEditRequest(call: UpstreamCall, expectedCount: number) {
  assert.equal(call.url, EDITS_ENDPOINT)
  assert.deepEqual(call.textFields.n, [String(expectedCount)])
  assert.deepEqual(call.textFields.prompt, [PROMPT])
  assert.deepEqual(call.textFields.quality, ["high"])
  assert.deepEqual(call.textFields.size, ["1024x1024"])
  assert.deepEqual(call.textFields.input_fidelity, ["high"])
  assert.equal(call.files.length, 1)
  assert.equal(call.files[0]?.name, "reference.png")
  assert.equal(call.files[0]?.type, "image/png")
  assert.match(call.files[0]?.key || "", /^image/)
}

async function loadCallImageStudioProxy(): Promise<CallImageStudioProxy> {
  const proxyModule = await import("../src/lib/image-studio-proxy").catch(() => null)
  const callImageStudioProxy = proxyModule && "callImageStudioProxy" in proxyModule
    ? (proxyModule as { callImageStudioProxy?: unknown }).callImageStudioProxy
    : null

  assert.equal(
    typeof callImageStudioProxy,
    "function",
    "image studio proxy helper should export the production request glue for route integration coverage"
  )

  return callImageStudioProxy as CallImageStudioProxy
}

async function runInputImageScenario(options: {
  outcomes: UpstreamOutcome[]
  total: number
}) {
  const callImageStudioProxy = await loadCallImageStudioProxy()
  const originalFetch = globalThis.fetch
  const proxyCalls: UpstreamCall[] = []
  const requestedCounts: number[] = []
  const routeResults: RouteResult[] = []
  const upstreamCalls: UpstreamCall[] = []
  let responseIndex = 0
  let firstThrownError: unknown = null

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (url === "/api/images" || url === "http://localhost/api/images") {
      assert.equal(init?.method, "POST")
      assert.ok(init?.body instanceof FormData)

      proxyCalls.push(snapshotFormData("/api/images", init.body))

      return await POST(
        new Request("http://localhost/api/images", {
          body: init.body,
          method: "POST",
          signal: init?.signal,
        })
      )
    }

    if (url === "data:,") {
      return new Response("", { status: 200 })
    }

    assert.equal(url, EDITS_ENDPOINT)
    assert.equal(init?.method, "POST")
    assert.ok(init?.body instanceof FormData)

    upstreamCalls.push(snapshotFormData(url, init.body))

    const outcome = options.outcomes[responseIndex]
    assert.ok(outcome, `missing mock outcome for request ${responseIndex + 1}`)
    responseIndex += 1

    if (!outcome.ok) {
      return createJsonResponse(
        {
          error: { message: outcome.errorMessage },
        },
        outcome.status || 500
      )
    }

    return createJsonResponse({
      created: responseIndex,
      data: Array.from({ length: outcome.imageCount }, (_, index) => ({
        b64_json: TRANSPARENT_PNG_BASE64,
        revised_prompt: `image-${responseIndex}-${index + 1}`,
      })),
    })
  }

    try {
      const result = await executeImageStudioRequestStrategy<RouteResult, { src: string }>({
        total: options.total,
        hasInputImages: true,
        request: async (requestedCount) => {
          requestedCounts.push(requestedCount)
          try {
            const routeResult = await callImageStudioProxy({
              apiKey: "test-key",
              background: "auto",
              endpoint: "https://api.openai.com/v1",
              imageCount: requestedCount,
              images: [createInputImage()],
              locale: "en",
              model: "gpt-image-2",
              outputFormat: "png",
              prompt: PROMPT,
              quality: "high",
              size: "1024x1024",
              timeoutMs: 2000,
            })

            routeResults.push(routeResult)
            return routeResult
          } catch (error) {
            if (!firstThrownError) {
            firstThrownError = error
          }

          throw error
        }
      },
      selectImages: (routeResult) => routeResult.images,
      })

      return { firstThrownError, proxyCalls, requestedCounts, result, routeResults, upstreamCalls }
    } finally {
      globalThis.fetch = originalFetch
    }
}

async function main() {
  const fullBatch = await runInputImageScenario({
    outcomes: [{ imageCount: 3, ok: true }],
    total: 3,
  })

  assert.deepEqual(fullBatch.requestedCounts, [3])
  assert.equal(fullBatch.proxyCalls[0]?.url, "/api/images")
  assert.deepEqual(fullBatch.proxyCalls[0]?.textFields.imageCount, ["3"])
  assert.deepEqual(fullBatch.proxyCalls[0]?.textFields.prompt, [PROMPT])
  assert.equal(fullBatch.proxyCalls[0]?.files.length, 1)
  assert.equal(fullBatch.routeResults[0]?.endpoint, EDITS_ENDPOINT)
  assert.equal(fullBatch.routeResults[0]?.debug?.request?.endpoint, EDITS_ENDPOINT)
  assert.equal(fullBatch.result.images.length, 3)
  assertEditRequest(fullBatch.upstreamCalls[0]!, 3)

  const shortBatch = await runInputImageScenario({
    outcomes: [
      { imageCount: 1, ok: true },
      { imageCount: 1, ok: true },
      { imageCount: 1, ok: true },
    ],
    total: 3,
  })

  assert.deepEqual(shortBatch.requestedCounts, [3, 1, 1])
  assert.deepEqual(
    shortBatch.upstreamCalls.map((call) => Number(call.textFields.n?.[0])),
    [3, 1, 1]
  )
  shortBatch.upstreamCalls.forEach((call, index) => {
    assertEditRequest(call, shortBatch.requestedCounts[index]!)
  })
  assert.equal(shortBatch.result.images.length, 3)
  assert.equal(shortBatch.result.isPartial, false)

  const batchFailureFallback = await runInputImageScenario({
    outcomes: [
      { errorMessage: "upstream batch failed", ok: false, status: 500 },
      { imageCount: 1, ok: true },
      { imageCount: 1, ok: true },
    ],
    total: 2,
  })

  assert.deepEqual(batchFailureFallback.requestedCounts, [2, 1, 1])
  assert.deepEqual(
    batchFailureFallback.upstreamCalls.map((call) => Number(call.textFields.n?.[0])),
    [2, 1, 1]
  )
  batchFailureFallback.upstreamCalls.forEach((call, index) => {
    assertEditRequest(call, batchFailureFallback.requestedCounts[index]!)
  })
  assert.equal(batchFailureFallback.result.images.length, 2)
  assert.equal(batchFailureFallback.result.isPartial, false)
  assert.equal(batchFailureFallback.result.firstError, batchFailureFallback.firstThrownError)
  assert.equal(
    batchFailureFallback.result.firstError instanceof Error && batchFailureFallback.result.firstError.message,
    "upstream batch failed"
  )
}

void main().catch((error) => {
  throw error
})
