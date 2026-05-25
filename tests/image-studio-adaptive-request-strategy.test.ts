import assert from "node:assert/strict"

import { getImageStudioRequestStrategy } from "../src/lib/image-studio-generation"
import * as generation from "../src/lib/image-studio-generation"

type MockImage = {
  id: string
}

type MockRequestResult = {
  images: MockImage[]
}

type ExecuteImageStudioRequestStrategy = <TRequestResult, TImage>(options: {
  total: number
  hasInputImages: boolean
  request: (requestedCount: number) => Promise<TRequestResult>
  selectImages: (result: TRequestResult) => readonly TImage[]
  isControlError?: (error: unknown) => boolean
}) => Promise<{
  images: TImage[]
  firstError: unknown
  isPartial: boolean
}>

const executeImageStudioRequestStrategy =
  (generation as Record<string, unknown>).executeImageStudioRequestStrategy

assert.equal(
  typeof executeImageStudioRequestStrategy,
  "function",
  "image studio generation helper should export a runtime request executor"
)

const execute = executeImageStudioRequestStrategy as ExecuteImageStudioRequestStrategy

function createImages(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}` }))
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

function waitForNextTurn() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

async function runSequence(options: {
  total: number
  hasInputImages: boolean
  outcomes: Array<MockRequestResult | Error>
}) {
  const calls: number[] = []
  let outcomeIndex = 0

  const result = await execute<MockRequestResult, MockImage>({
    total: options.total,
    hasInputImages: options.hasInputImages,
    request: async (requestedCount) => {
      calls.push(requestedCount)
      const outcome = options.outcomes[outcomeIndex]

      assert.ok(outcome, `missing mock outcome for request ${outcomeIndex + 1}`)
      outcomeIndex += 1

      if (outcome instanceof Error) {
        throw outcome
      }

      return outcome
    },
    selectImages: (result) => result.images,
  })

  return { calls, result }
}

assert.deepEqual(
  getImageStudioRequestStrategy(3, false),
  {
    requestedCount: 1,
    useBatchedRequest: false,
  },
  "text-only generations should stay on repeated single-image requests"
)

assert.deepEqual(
  getImageStudioRequestStrategy(3, true),
  {
    requestedCount: 3,
    useBatchedRequest: true,
  },
  "generations with input images should switch to one batched request"
)

async function main() {
  const textOnly = await runSequence({
    total: 3,
    hasInputImages: false,
    outcomes: [
      { images: createImages(1, "text-1") },
      { images: createImages(1, "text-2") },
      { images: createImages(1, "text-3") },
    ],
  })

  assert.deepEqual(
    textOnly.calls,
    [1, 1, 1],
    "text-only generations should keep issuing one-image requests"
  )

  assert.equal(textOnly.result.images.length, 3, "text-only generations should collect every successful image")
  assert.equal(textOnly.result.isPartial, false, "full text-only generations should not be marked partial")

  const inputImageBatchOnly = await runSequence({
    total: 3,
    hasInputImages: true,
    outcomes: [{ images: createImages(3, "batch") }],
  })

  assert.deepEqual(
    inputImageBatchOnly.calls,
    [3],
    "input-image generations should stop after a full opening batch"
  )

  const inputImageTopUpCalls: number[] = []
  const openingBatch = createDeferred<MockRequestResult>()
  const topUpResponses = [createDeferred<MockRequestResult>(), createDeferred<MockRequestResult>()]
  let topUpResponseIndex = 0

  const pendingInputImageTopUp = execute<MockRequestResult, MockImage>({
    total: 3,
    hasInputImages: true,
    request: (requestedCount) => {
      inputImageTopUpCalls.push(requestedCount)

      if (requestedCount === 3) {
        return openingBatch.promise
      }

      const response = topUpResponses[topUpResponseIndex]
      assert.ok(response, `missing top-up response ${topUpResponseIndex + 1}`)
      topUpResponseIndex += 1
      return response.promise
    },
    selectImages: (result) => result.images,
  })

  await waitForNextTurn()

  assert.deepEqual(
    inputImageTopUpCalls,
    [3],
    "input-image generations should start with exactly one batched request before the opening batch settles"
  )

  openingBatch.resolve({ images: createImages(1, "batch-short") })
  await waitForNextTurn()

  assert.deepEqual(
    inputImageTopUpCalls,
    [3, 1, 1],
    "short input-image batches should only enter one-image top-ups after the opening batch resolves"
  )

  topUpResponses[0].resolve({ images: createImages(1, "top-up-1") })
  topUpResponses[1].resolve({ images: createImages(1, "top-up-2") })

  const inputImageTopUp = await pendingInputImageTopUp

  assert.equal(
    inputImageTopUp.images.length,
    3,
    "short input-image batches should still collect enough fallback images to reach the requested total"
  )

  const batchError = new Error("batch failed")
  const inputImageBatchErrorCalls: number[] = []
  const rejectedOpeningBatch = createDeferred<MockRequestResult>()
  const retryResponses = [createDeferred<MockRequestResult>(), createDeferred<MockRequestResult>()]
  let retryResponseIndex = 0

  const pendingInputImageBatchError = execute<MockRequestResult, MockImage>({
    total: 2,
    hasInputImages: true,
    request: (requestedCount) => {
      inputImageBatchErrorCalls.push(requestedCount)

      if (requestedCount === 2) {
        return rejectedOpeningBatch.promise
      }

      const response = retryResponses[retryResponseIndex]
      assert.ok(response, `missing retry response ${retryResponseIndex + 1}`)
      retryResponseIndex += 1
      return response.promise
    },
    selectImages: (result) => result.images,
  })

  await waitForNextTurn()

  assert.deepEqual(
    inputImageBatchErrorCalls,
    [2],
    "ordinary input-image batches should not start one-image retries before the opening batch rejects"
  )

  rejectedOpeningBatch.reject(batchError)
  await waitForNextTurn()

  assert.deepEqual(
    inputImageBatchErrorCalls,
    [2, 1, 1],
    "ordinary batched-request failures should only fall back to one-image retries after the opening batch rejects"
  )

  retryResponses[0].resolve({ images: createImages(1, "retry-1") })
  retryResponses[1].resolve({ images: createImages(1, "retry-2") })

  const inputImageBatchError = await pendingInputImageBatchError

  assert.equal(
    inputImageBatchError.firstError,
    batchError,
    "the first ordinary request error should be preserved for partial/failure reporting"
  )

  const shortFinalResult = await runSequence({
    total: 3,
    hasInputImages: true,
    outcomes: [
      { images: createImages(1, "batch-short-final") },
      { images: [] },
      { images: [] },
    ],
  })

  assert.deepEqual(
    shortFinalResult.calls,
    [3, 1, 1],
    "short input-image batches should still spend the remaining retry budget on top-ups"
  )

  assert.equal(
    shortFinalResult.result.isPartial,
    true,
    "a short final image set should remain marked partial even without an ordinary thrown error"
  )

  const controlError = new Error("stopped")
  const controlCalls: number[] = []

  await assert.rejects(
    execute<MockRequestResult, MockImage>({
      total: 2,
      hasInputImages: true,
      request: async (requestedCount) => {
        controlCalls.push(requestedCount)
        throw controlError
      },
      selectImages: (result) => result.images,
      isControlError: (error) => error === controlError,
    }),
    (error) => {
      assert.equal(error, controlError)
      return true
    },
    "abort/timeout-style control errors should still stop immediately"
  )

  assert.deepEqual(
    controlCalls,
    [2],
    "control errors should not enter the one-image fallback loop"
  )
}

void main().catch((error) => {
  throw error
})
