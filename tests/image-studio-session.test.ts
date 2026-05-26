import assert from "node:assert/strict"

import { runImageStudioSession } from "../src/lib/image-studio-session"

type SessionPayload = {
  debug?: {
    request?: {
      imageCount?: number
    }
  }
  endpoint?: string
  images: Array<{
    revisedPrompt?: string
    src: string
  }>
  quality?: string
  qualityReported?: boolean
  size?: string
  sizeReported?: boolean
}

type ProxyCall = {
  fileNames: string[]
  imageCount: string[]
  prompt: string[]
  signal: AbortSignal | null
  timeoutMs: string[]
}

type MockFetchOutcome =
  | SessionPayload
  | Error
  | ((call: ProxyCall, callIndex: number) => SessionPayload | Error | Promise<SessionPayload | Error>)

const MOCK_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b5mQAAAAASUVORK5CYII="
const TEXT_ENDPOINT = "https://mocked.example/v1/images/generations"
const EDIT_ENDPOINT = "https://mocked.example/v1/images/edits"

function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  })
}

function createInputImage() {
  return new File([Buffer.from(MOCK_IMAGE_BASE64, "base64")], "reference.png", {
    type: "image/png",
  })
}

function createSessionPayload(endpoint: string, revisedPrompt: string): SessionPayload {
  return {
    endpoint,
    images: [{ revisedPrompt, src: `data:image/png;base64,${MOCK_IMAGE_BASE64}` }],
    quality: "high",
    qualityReported: true,
    size: "1024x1024",
    sizeReported: true,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, reject, resolve }
}

function waitForNextTurn() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

function snapshotFormData(formData: FormData, signal?: AbortSignal | null): ProxyCall {
  return {
    fileNames: formData.getAll("images").map((value) => value instanceof File ? value.name : String(value)),
    imageCount: formData.getAll("imageCount").map(String),
    prompt: formData.getAll("prompt").map(String),
    signal: signal ?? null,
    timeoutMs: formData.getAll("timeoutMs").map(String),
  }
}

async function withMockedFetch<T>(
  outcomes: MockFetchOutcome[],
  run: (calls: ProxyCall[]) => Promise<T>
) {
  const originalFetch = globalThis.fetch
  const calls: ProxyCall[] = []
  let outcomeIndex = 0

  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "POST")
    assert.ok(init?.body instanceof FormData)

    const call = snapshotFormData(init.body, init.signal)
    calls.push(call)

    const outcome = outcomes[outcomeIndex]
    assert.ok(outcome, `missing outcome ${outcomeIndex + 1}`)
    outcomeIndex += 1

    const resolvedOutcome = typeof outcome === "function"
      ? await outcome(call, outcomeIndex - 1)
      : outcome

    if (resolvedOutcome instanceof Error) {
      throw resolvedOutcome
    }

    return createJsonResponse(resolvedOutcome)
  }

  try {
    return await run(calls)
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function main() {
  const textOnlyUpdates: number[] = []
  const textOnlyController = new AbortController()

  const textOnly = await withMockedFetch(
    [
      createSessionPayload(TEXT_ENDPOINT, "text-1"),
      createSessionPayload(TEXT_ENDPOINT, "text-2"),
      createSessionPayload(TEXT_ENDPOINT, "text-3"),
    ],
    async (calls) => {
      const result = await runImageStudioSession({
        apiKey: "sk-test",
        background: "auto",
        endpoint: "https://api.openai.com/v1",
        imageCount: 3,
        images: [],
        locale: "en",
        model: "gpt-image-2",
        onImagesUpdated: (images) => textOnlyUpdates.push(images.length),
        outputFormat: "png",
        prompt: "Editorial watch portrait",
        quality: "high",
        signal: textOnlyController.signal,
        size: "1024x1024",
        timeoutMs: 2000,
      })

      assert.deepEqual(calls.map((call) => call.imageCount[0]), ["1", "1", "1"])
      assert.deepEqual(calls.map((call) => call.prompt[0]), [
        "Editorial watch portrait",
        "Editorial watch portrait",
        "Editorial watch portrait",
      ])
      assert.deepEqual(calls.map((call) => call.timeoutMs[0]), ["2000", "2000", "2000"])
      calls.forEach((call) => {
        assert.equal(call.signal, textOnlyController.signal)
      })
      assert.deepEqual(textOnlyUpdates, [1, 2, 3])
      assert.equal(result.images.length, 3)
      assert.equal(result.endpoint, TEXT_ENDPOINT)
      assert.equal(result.isPartial, false)

      return result
    }
  )

  assert.equal(textOnly.quality, "high")
  assert.equal(textOnly.size, "1024x1024")

  const inputImage = createInputImage()
  const inputImageUpdates: number[] = []
  const inputImageController = new AbortController()

  await withMockedFetch(
    [
      createSessionPayload(EDIT_ENDPOINT, "edit-1"),
      createSessionPayload(EDIT_ENDPOINT, "edit-2"),
      createSessionPayload(EDIT_ENDPOINT, "edit-3"),
    ],
    async (calls) => {
      const result = await runImageStudioSession({
        apiKey: "sk-test",
        background: "auto",
        endpoint: "https://api.openai.com/v1",
        imageCount: 3,
        images: [inputImage],
        locale: "en",
        model: "gpt-image-2",
        onImagesUpdated: (images) => inputImageUpdates.push(images.length),
        outputFormat: "png",
        prompt: "Retouch the uploaded bottle shot",
        quality: "high",
        signal: inputImageController.signal,
        size: "1024x1024",
        timeoutMs: 2000,
      })

      assert.deepEqual(calls.map((call) => call.imageCount[0]), ["3", "1", "1"])
      assert.deepEqual(calls.map((call) => call.fileNames), [["reference.png"], ["reference.png"], ["reference.png"]])
      assert.deepEqual(calls.map((call) => call.prompt[0]), [
        "Retouch the uploaded bottle shot",
        "Retouch the uploaded bottle shot",
        "Retouch the uploaded bottle shot",
      ])
      assert.deepEqual(calls.map((call) => call.timeoutMs[0]), ["2000", "2000", "2000"])
      calls.forEach((call) => {
        assert.equal(call.signal, inputImageController.signal)
      })
      assert.deepEqual(inputImageUpdates, [1, 2, 3])
      assert.equal(result.images.length, 3)
      assert.equal(result.endpoint, EDIT_ENDPOINT)
    }
  )

  const partialControlUpdates: number[] = []
  const partialControlSuccess = createDeferred<SessionPayload>()
  const partialControlFailure = createDeferred<SessionPayload>()
  const controlError = new Error("generation timed out")
  const partialControlController = new AbortController()

  await withMockedFetch(
    [
      () => partialControlSuccess.promise,
      () => partialControlFailure.promise,
    ],
    async (calls) => {
      const pendingSession = runImageStudioSession({
        apiKey: "sk-test",
        background: "auto",
        endpoint: "https://api.openai.com/v1",
        imageCount: 2,
        images: [],
        isControlError: (error) => error === controlError,
        locale: "en",
        model: "gpt-image-2",
        onImagesUpdated: (images) => partialControlUpdates.push(images.length),
        outputFormat: "png",
        prompt: "Partial before timeout",
        quality: "high",
        signal: partialControlController.signal,
        size: "1024x1024",
        timeoutMs: 3200,
      })

      await waitForNextTurn()

      assert.deepEqual(calls.map((call) => call.imageCount[0]), ["1", "1"])
      assert.deepEqual(calls.map((call) => call.timeoutMs[0]), ["3200", "3200"])
      calls.forEach((call) => {
        assert.equal(call.signal, partialControlController.signal)
      })

      partialControlSuccess.resolve(createSessionPayload(TEXT_ENDPOINT, "partial-before-timeout"))
      await waitForNextTurn()

      assert.deepEqual(
        partialControlUpdates,
        [1],
        "partial images should publish before a later control error rejects the session"
      )

      partialControlFailure.reject(controlError)

      await assert.rejects(
        pendingSession,
        (error) => {
          assert.equal(error, controlError)
          return true
        },
        "control errors should still reject the session after partial progress"
      )

      assert.equal(calls.length, 2, "control errors should not trigger extra fallback requests")
    }
  )

  const partialOrdinaryUpdates: number[] = []
  const firstPartialSuccess = createDeferred<SessionPayload>()
  const firstPartialFailure = createDeferred<SessionPayload>()
  const primaryOrdinaryError = new Error("first ordinary failure")
  const fallbackOrdinaryError = new Error("fallback ordinary failure")
  const finalOrdinaryError = new Error("final ordinary failure")
  const partialOrdinaryController = new AbortController()

  const ordinaryPartial = await withMockedFetch(
    [
      () => firstPartialSuccess.promise,
      () => firstPartialFailure.promise,
      fallbackOrdinaryError,
      finalOrdinaryError,
    ],
    async (calls) => {
      const pendingSession = runImageStudioSession({
        apiKey: "sk-test",
        background: "auto",
        endpoint: "https://api.openai.com/v1",
        imageCount: 2,
        images: [],
        locale: "en",
        model: "gpt-image-2",
        onImagesUpdated: (images) => partialOrdinaryUpdates.push(images.length),
        outputFormat: "png",
        prompt: "Partial before ordinary failure",
        quality: "high",
        signal: partialOrdinaryController.signal,
        size: "1024x1024",
        timeoutMs: 4100,
      })

      await waitForNextTurn()

      assert.deepEqual(calls.map((call) => call.imageCount[0]), ["1", "1"])
      assert.deepEqual(calls.map((call) => call.timeoutMs[0]), ["4100", "4100"])
      calls.forEach((call) => {
        assert.equal(call.signal, partialOrdinaryController.signal)
      })

      firstPartialSuccess.resolve(createSessionPayload(TEXT_ENDPOINT, "partial-before-ordinary"))
      await waitForNextTurn()

      assert.deepEqual(
        partialOrdinaryUpdates,
        [1],
        "partial images should publish before later ordinary request failures finish the session"
      )

      firstPartialFailure.reject(primaryOrdinaryError)

      const result = await pendingSession

      assert.deepEqual(
        calls.map((call) => call.imageCount[0]),
        ["1", "1", "1", "1"],
        "ordinary failures after partial success should keep spending the remaining retry budget"
      )

      return result
    }
  )

  assert.equal(ordinaryPartial.images.length, 1)
  assert.equal(ordinaryPartial.firstError, primaryOrdinaryError)
  assert.equal(ordinaryPartial.isPartial, true)

  const initialControlController = new AbortController()

  await assert.rejects(
    withMockedFetch([controlError], async (calls) => {
      await runImageStudioSession({
        apiKey: "sk-test",
        background: "auto",
        endpoint: "https://api.openai.com/v1",
        imageCount: 2,
        images: [inputImage],
        isControlError: (error) => error === controlError,
        locale: "en",
        model: "gpt-image-2",
        outputFormat: "png",
        prompt: "Timeout path",
        quality: "high",
        signal: initialControlController.signal,
        size: "1024x1024",
        timeoutMs: 2000,
      })

      assert.deepEqual(calls.map((call) => call.imageCount[0]), ["2"])
      assert.deepEqual(calls.map((call) => call.timeoutMs[0]), ["2000"])
      calls.forEach((call) => {
        assert.equal(call.signal, initialControlController.signal)
      })
    }),
    (error) => {
      assert.equal(error, controlError)
      return true
    }
  )
}

void main().catch((error) => {
  throw error
})
