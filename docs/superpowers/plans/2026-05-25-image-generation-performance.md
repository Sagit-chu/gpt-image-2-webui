# Image Generation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep text-only generation on the existing fast parallel path, start input-image generations with one batched proxy request, fall back to single-image top-ups when that batch is short or throws an ordinary error, and bound old history rendering so long sessions stay lighter.

**Architecture:** Request orchestration now lives in `src/lib/image-studio-generation.ts`, while the client-side `ImageStudio` component keeps owning `callProxy()`, result state, progress publishing, and rendering. The helper handles the batch-first/fallback sequencing and exports the shared history limit constant used by the component and tests.

**Tech Stack:** Next.js 16 App Router, React 19 client components, TypeScript, Node `assert`, `tsx`, ESLint

**Git:** Do not commit for this task.

---

## File Map

- `src/lib/image-studio-generation.ts`
  - Owns the adaptive request helper, the strategy selector, and the shared history limit constant.
- `src/components/image-studio.tsx`
  - Owns `callProxy()`, `startGeneration()`, `history`, and all relevant `<img>` rendering.
  - Delegates request sequencing to the helper while preserving abort/timeout handling and result publishing.
- `tests/image-studio-adaptive-request-strategy.test.ts`
  - Behavior-level regression for text-only fan-out vs input-image batch-first fallback sequencing.
- `tests/image-studio-history-window.test.ts`
  - Regression for the shared history cap and lazy/async history thumbnails.
- Existing regression tests under `tests/`
  - Re-run to confirm request controls, history keys, summary counts, and proxy behavior still match the current contract.

## Finalized Implementation Notes

- Add a failing behavior-level test around a new helper seam in `src/lib/image-studio-generation.ts` instead of relying only on source regex checks.
- Count the opening input-image batch as consuming `total` attempts from the existing `total + 2` budget.
- If that opening batch is short or throws an ordinary error, fall back to the existing single-image top-up loop with the remaining budget.
- Keep abort/timeout-style control errors as immediate stop conditions.
- Export `IMAGE_STUDIO_HISTORY_LIMIT` from the helper module and reuse it in the component and tests to avoid drift.

## Verification Targets

- `npx tsx tests/image-studio-adaptive-request-strategy.test.ts`
- `npx tsx tests/image-studio-history-window.test.ts`
- `npx tsx tests/image-studio-missing-api-key-dialog.test.ts`
- `npx tsx tests/image-studio-remember-key-dialog.test.ts`
- `npx tsx tests/image-studio-stop-timeout-controls.test.ts`
- `npx tsx tests/image-studio-history-keys.test.ts`
- `npx tsx tests/image-studio-requested-summary.test.ts`
- `npx tsx tests/image-route-debug-summary.test.ts`
- `npx tsx tests/image-route-edit-input-fidelity.test.ts`
- `npx tsx tests/image-route-reported-fields.test.ts`
- `npx tsx tests/image-route-timeout.test.ts`
- `pnpm lint`

### Task 1: Extract the generation helper/runtime seam

**Files:**
- Modify: `src/lib/image-studio-generation.ts`
- Modify: `src/components/image-studio.tsx`

- [ ] **Step 1: Add the request-strategy helper surface in `src/lib/image-studio-generation.ts`**

```ts
export function getImageStudioRequestStrategy(total: number, hasInputImages: boolean) {
  const normalizedTotal = Math.min(Math.max(total, 1), 4)

  return {
    requestedCount: hasInputImages ? normalizedTotal : 1,
    useBatchedRequest: hasInputImages,
  }
}

export async function executeImageStudioRequestStrategy<TRequestResult, TImage>({
  total,
  hasInputImages,
  request,
  selectImages,
  onRequestResult,
  onImagesUpdated,
  isControlError,
}: ExecuteImageStudioRequestStrategyOptions<TRequestResult, TImage>) {
  // helper owns request sequencing only; component still owns state/toasts
}
```

- [ ] **Step 2: Keep `callProxy()` and all UI state in `ImageStudio`, but import the helper seam**

```ts
import {
  IMAGE_STUDIO_HISTORY_LIMIT,
  appendImageStudioHistory,
  executeImageStudioRequestStrategy,
} from "@/lib/image-studio-generation"
```

`ImageStudio` should continue to own `callProxy()`, `createResult()`, `publishResult()`, `applyProxyResult()`, progress updates, and toasts. The helper only receives callbacks so tests can drive the sequencing at runtime without mounting the component.

- [ ] **Step 3: Keep the helper boundaries narrow and reusable**

The extracted module should expose exactly the pieces the final code uses:

```ts
export const IMAGE_STUDIO_HISTORY_LIMIT = 6
export function getImageStudioRequestStrategy(...)
export async function executeImageStudioRequestStrategy(...)
export function appendImageStudioHistory(...)
```

That keeps sequencing and history-window rules out of the component while avoiding a second proxy client or duplicate UI logic.

### Task 2: Lock adaptive request sequencing with behavior-level tests

**Files:**
- Modify: `tests/image-studio-adaptive-request-strategy.test.ts`
- Test: `src/lib/image-studio-generation.ts`

- [ ] **Step 1: Replace source-regex coverage with direct helper execution**

```ts
import { getImageStudioRequestStrategy } from "../src/lib/image-studio-generation"
import * as generation from "../src/lib/image-studio-generation"

const executeImageStudioRequestStrategy =
  (generation as Record<string, unknown>).executeImageStudioRequestStrategy
```

Assert that `executeImageStudioRequestStrategy` is exported at runtime so the test verifies the real helper seam rather than matching component source text.

- [ ] **Step 2: Cover the final request sequences instead of implementation details**

```ts
assert.deepEqual(textOnly.calls, [1, 1, 1])
assert.deepEqual(inputImageBatchOnly.calls, [3])
assert.deepEqual(inputImageTopUp.calls, [3, 1, 1])
assert.deepEqual(inputImageBatchError.calls, [2, 1, 1])
assert.equal(shortFinalResult.result.isPartial, true)
```

The test should model outcomes with a mock `request()` function and verify the observable sequencing rules:

- text-only generations keep repeated one-image requests
- input-image generations start with one batched request
- short batched responses fall back to one-image top-ups
- ordinary batched-request errors also fall back to one-image top-ups

- [ ] **Step 3: Keep the error-handling assertions at behavior level**

```ts
assert.equal(inputImageBatchError.result.firstError, batchError)

await assert.rejects(
  execute({
    total: 2,
    hasInputImages: true,
    request: async () => {
      throw controlError
    },
    isControlError: (error) => error === controlError,
  })
)

assert.deepEqual(controlCalls, [2])
```

Preserve coverage that the first ordinary error is retained for partial/failure reporting, while abort/timeout-style control errors stop immediately and never enter the single-image fallback loop.

- [ ] **Step 4: Run the focused adaptive-strategy test**

Run: `npx tsx tests/image-studio-adaptive-request-strategy.test.ts`
Expected: no output, exit code `0`.

### Task 3: Wire batch-first input-image fallback into `ImageStudio`

**Files:**
- Modify: `src/components/image-studio.tsx`
- Modify: `src/lib/image-studio-generation.ts`
- Test: `tests/image-studio-adaptive-request-strategy.test.ts`
- Test: `tests/image-studio-missing-api-key-dialog.test.ts`
- Test: `tests/image-studio-remember-key-dialog.test.ts`
- Test: `tests/image-studio-stop-timeout-controls.test.ts`

- [ ] **Step 1: Keep result publishing local to `startGeneration()`**

```ts
const createResult = (visibleImages: GeneratedImage[]): StudioResponse => ({ ... })

const publishResult = (visibleImages: GeneratedImage[]) => {
  if (!visibleImages.length) {
    return
  }

  completedCount = visibleImages.length
  setResult(createResult(visibleImages))
  setSelectedImageIndex((current) => current < visibleImages.length ? current : 0)
  setProgress(Math.min(95, 8 + Math.round((visibleImages.length / total) * 87)))
}

const applyProxyResult = (proxyResult: Awaited<ReturnType<typeof callProxy>>) => {
  collectedEndpoint = proxyResult.endpoint
  resultDebug = proxyResult.debug || resultDebug
  resultQuality = proxyResult.quality || quality
  resultQualityReported = proxyResult.qualityReported
  resultSize = proxyResult.size || size
  resultSizeReported = proxyResult.sizeReported
}
```

The helper should not know anything about React state, toasts, or summary fields; it only reports request results and visible-image updates back through callbacks.

- [ ] **Step 2: Delegate sequencing to `executeImageStudioRequestStrategy()`**

```ts
const requestResult = await executeImageStudioRequestStrategy({
  total,
  hasInputImages: inputUploadCount > 0,
  request: (requestedCount) => callProxy(requestedCount, generationController, effectiveApiKey),
  selectImages: (proxyResult) => proxyResult.images,
  onRequestResult: applyProxyResult,
  onImagesUpdated: publishResult,
  isControlError: (error) => (
    isGenerationControlError(error, "GenerationAbortError") ||
    isGenerationControlError(error, "GenerationTimeoutError")
  ),
})
```

This keeps text-only runs on the existing fast path while switching input-image runs to the helper's batch-first strategy.

- [ ] **Step 3: Implement the final batch-first fallback rules inside the helper**

```ts
if (requestStrategy.useBatchedRequest) {
  attempts += requestStrategy.requestedCount
  await runRequest(requestStrategy.requestedCount)
}

while (images.length < normalizedTotal && attempts < maxAttempts) {
  const batchSize = Math.min(normalizedTotal - images.length, maxAttempts - attempts)
  attempts += batchSize

  await Promise.all(Array.from({ length: batchSize }, () => runRequest(singleRequestCount)))
}
```

The opening input-image batch must consume its share of the existing `total + 2` budget. If that batch returns too few images or throws an ordinary error, the helper should reuse the remaining budget on one-image top-ups. Abort/timeout control errors still re-throw immediately.

- [ ] **Step 4: Keep completion handling driven by the helper result**

```ts
if (!requestResult.images.length) {
  throw requestResult.firstError instanceof Error
    ? requestResult.firstError
    : new Error(text.allRequestsFailed)
}

if (requestResult.isPartial) {
  toast.warning(...)
} else {
  toast.success(...)
}
```

The component should continue to decide whether the final result is full or partial, but the decision now comes from `requestResult.images`, `requestResult.firstError`, and `requestResult.isPartial`.

- [ ] **Step 5: Re-run the submit-flow regressions around the new helper call**

Run: `npx tsx tests/image-studio-adaptive-request-strategy.test.ts`
Expected: no output, exit code `0`.

Run: `npx tsx tests/image-studio-missing-api-key-dialog.test.ts`
Expected: no output, exit code `0`.

Run: `npx tsx tests/image-studio-remember-key-dialog.test.ts`
Expected: no output, exit code `0`.

Run: `npx tsx tests/image-studio-stop-timeout-controls.test.ts`
Expected: no output, exit code `0`.

### Task 4: Share the history limit and lock history thumbnail behavior

**Files:**
- Modify: `src/lib/image-studio-generation.ts`
- Modify: `src/components/image-studio.tsx`
- Modify: `tests/image-studio-history-window.test.ts`
- Test: `tests/image-studio-history-keys.test.ts`
- Test: `tests/image-studio-requested-summary.test.ts`

- [ ] **Step 1: Export the shared history-window helper state from `src/lib/image-studio-generation.ts`**

```ts
export const IMAGE_STUDIO_HISTORY_LIMIT = 6

export function appendImageStudioHistory<T extends HasId>(history: readonly T[], next: T, limit = IMAGE_STUDIO_HISTORY_LIMIT) {
  if (history.some((item) => item.id === next.id)) {
    return history as T[]
  }

  return [next, ...history].slice(0, limit)
}
```

This removes drift between the component and tests and gives the history window its own runtime helper coverage.

- [ ] **Step 2: Use the shared helper from `ImageStudio` instead of a local cap constant**

```ts
if (result) {
  setHistory((current) => appendImageStudioHistory(current, result, IMAGE_STUDIO_HISTORY_LIMIT))
}
```

Do not keep a duplicate `const MAX_HISTORY_ITEMS = 6` inside the component.

- [ ] **Step 3: Convert `tests/image-studio-history-window.test.ts` into mixed helper-behavior and source coverage**

```ts
assert.equal(sharedHistoryLimit, 6)
assert.deepEqual(appendImageStudioHistory(history, next), [next, ...history.slice(0, historyLimit - 1)])
assert.deepEqual(
  appendImageStudioHistory([{ id: "duplicate" }, ...history.slice(0, historyLimit - 1)], { id: "duplicate" }),
  [{ id: "duplicate" }, ...history.slice(0, historyLimit - 1)],
)
```

Keep source assertions that the component:

- imports `IMAGE_STUDIO_HISTORY_LIMIT` from `@/lib/image-studio-generation`
- calls `appendImageStudioHistory(current, result, IMAGE_STUDIO_HISTORY_LIMIT)`
- does not reintroduce a local `MAX_HISTORY_ITEMS`
- renders history thumbnail `<img>` tags with `loading="lazy"` and `decoding="async"`
- leaves the active result image markup unchanged

- [ ] **Step 4: Run the focused history regressions**

Run: `npx tsx tests/image-studio-history-window.test.ts`
Expected: no output, exit code `0`.

Run: `npx tsx tests/image-studio-history-keys.test.ts`
Expected: no output, exit code `0`.

Run: `npx tsx tests/image-studio-requested-summary.test.ts`
Expected: no output, exit code `0`.

### Task 5: Final regression verification

**Files:**
- Test: `tests/image-studio-adaptive-request-strategy.test.ts`
- Test: `tests/image-studio-history-window.test.ts`
- Test: `tests/image-studio-missing-api-key-dialog.test.ts`
- Test: `tests/image-studio-remember-key-dialog.test.ts`
- Test: `tests/image-studio-stop-timeout-controls.test.ts`
- Test: `tests/image-studio-history-keys.test.ts`
- Test: `tests/image-studio-requested-summary.test.ts`
- Test: `tests/image-route-debug-summary.test.ts`
- Test: `tests/image-route-edit-input-fidelity.test.ts`
- Test: `tests/image-route-reported-fields.test.ts`
- Test: `tests/image-route-timeout.test.ts`

- [ ] **Step 1: Re-run the entire verification matrix exactly as listed above**

Run every command in `## Verification Targets` without substituting older `rtk pnpm exec ...` wrappers.

Expected:

- every `npx tsx ...` command exits `0`
- `pnpm lint` exits `0`
- no follow-up production or test edits are needed after the helper extraction, behavior tests, shared history constant, and thumbnail assertions settle
