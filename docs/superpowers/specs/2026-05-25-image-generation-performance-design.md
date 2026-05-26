# Image Generation Performance Design

## Goal

Improve image-generation performance in the studio without changing the proxy contract by keeping the current text-only fan-out behavior, starting input-image generations with one batched proxy call, falling back to single-image top-ups when that batch is short or throws an ordinary error, and reducing long-session client render/memory cost.

## Approved Scope

- Keep the existing parallel single-image request behavior for text-only generation runs.
- Start input-image generation runs with one batched `/api/images` request that uses the requested `imageCount`, then fall back to the existing single-image top-up loop when needed.
- Keep result presentation, partial-count summaries, and download/history behavior as compatible as possible with the current UI.
- Cap retained history to a small recent window of six prior generations.
- Add browser-native lazy/decode hints for non-critical rendered images.

## Non-Goals

- No new image proxy route.
- No removal of server-side image materialization.
- No transport redesign such as upload deduplication tokens or pre-staged files.
- No change to the intentional text-only first-image optimization.
- No redesign of the studio layout, result cards, or history UI.
- No persistence of generation history to local storage or a backend.

## Current Code Constraints

- `callProxy(requestedCount, generationController, requestApiKey)` in `src/components/image-studio.tsx` already sends `imageCount` plus all current input images to `/api/images`.
- `POST` in `src/app/api/images/route.ts` already maps `imageCount` to `n` for both `client.images.generate()` and `client.images.edit()`.
- The current client generation loop in `startGeneration()` always calls `callProxy(1, ...)`, then uses `Promise.all(...)` to top up until it reaches the requested count.
- Input-image runs use `inputUploads`, which includes both explicit reference uploads and the staged `activeSource` remix image.
- `history` is stored as an unbounded `StudioResponse[]` in `src/components/image-studio.tsx`.
- Generated images are often retained as inline `data:image/...` strings after `materializeGeneratedImages()` in `src/lib/image-request.ts`, so unbounded history grows both memory pressure and DOM work over long sessions.

## Root Cause Summary

1. Text-only and input-image runs currently share the same client request fan-out path.
2. That fan-out path repeatedly uploads the same input files because edit/reference/remix runs still call the proxy multiple times with `imageCount=1`.
3. The UI keeps every previous result and renders every retained image immediately, so long sessions accumulate heavy inline image data and a growing history DOM.

## Approaches Considered

### 1. Adaptive client strategy plus bounded history

Recommended.

- Keep text-only runs on the existing `callProxy(1)` parallel fan-out path.
- Detect any input-image run and switch it to one `callProxy(total)` request.
- Bound history in client state and lazy-render older thumbnails.

Why it wins:

- Fixes the established upload amplification problem directly.
- Preserves the existing text-only behavior that was intentionally chosen for first-image latency and reliability.
- Stays inside already-supported client/proxy interfaces.
- Avoids scope expansion into larger transport changes.

### 2. Always batch every generation request

Rejected.

- Simpler on paper, but it would discard the current text-only parallel behavior that was explicitly kept for performance and reliability reasons.

### 3. Introduce a new proxy/upload staging flow

Rejected for this round.

- It could reduce upload duplication further, but it requires broader API and transport changes that are explicitly out of scope.

## Recommended Architecture

Make the client request strategy adaptive through `src/lib/image-studio-generation.ts`, with `startGeneration()` in `src/components/image-studio.tsx` delegating request sequencing to that helper.

- When `inputUploads.length === 0`, keep the current text-only flow: repeated `callProxy(1, ...)` requests with the existing parallel top-up loop.
- When `inputUploads.length > 0`, make one `callProxy(total, ...)` request first so the proxy receives the full requested count and the shared input images only once.
- Count that opening batch as consuming `total` attempts from the existing `total + 2` attempt budget.
- If the opening batch is short or throws an ordinary error, reuse the existing single-image top-up loop with the remaining budget.
- Reuse the existing result creation, progress updates, summary fields, and toast flow so the visible UX stays familiar.
- Bound `history` when pushing the previous `result` into retained session state by using one shared exported limit constant.
- Mark history thumbnails as low-priority browser work with `loading="lazy"` and `decoding="async"`.

No `/api/images` route changes are required for the batching behavior itself because the route already accepts `imageCount` and forwards it as `n`.

## Request Strategy Design

### Strategy Selection

Inside `startGeneration()`:

- Compute `total` exactly as today from the user-selected `imageCount`.
- Compute `hasInputImages` from `inputUploads.length > 0`.
- Use `hasInputImages`, not `uploads.length`, so remix runs that only use `activeSource` also take the batched path.

### Text-Only Path

Keep the existing behavior for `hasInputImages === false`:

- request one image per proxy call with `callProxy(1, ...)`
- keep the existing `Promise.all(...)` top-up loop
- keep partial-result publishing during the run
- keep the current timeout, abort, and first-error handling

This preserves the current first-image and retry behavior for prompt-only runs.

### Input-Image Path

For `hasInputImages === true`:

- issue one `callProxy(total, generationController, effectiveApiKey)` request first
- reuse the same metadata application path used by text-only requests
- append the returned images once, clipped to `total`
- if the batch is short or throws an ordinary error, continue with `callProxy(1, ...)` top-up requests while attempt budget remains
- keep abort and timeout errors as immediate stop conditions without entering fallback

This removes repeated re-uploading of the same input files across multi-image edit/reference/remix runs.

### Compatibility Notes

- Keep `requestedCount: total` in `StudioResponse` for both strategies.
- Keep the existing count summary behavior: if fewer images are returned than requested, the UI should continue showing `generated/requested` counts through the current summary fields.
- A full opening batch still ends the run immediately.
- A short final result should still be treated as partial even if no ordinary error object is available.

## Front-End Render and Memory Design

### History Window

Export `IMAGE_STUDIO_HISTORY_LIMIT = 6` from `src/lib/image-studio-generation.ts` and reuse it in `src/components/image-studio.tsx` and the related tests.

- Apply the cap only when moving the previous `result` into `history` at the start of a new generation.
- Keep the newest historical entry first.
- Preserve the current duplicate guard by `result.id` before slicing.
- Leave the active `result` uncapped; the cap applies only to prior generations.

This keeps enough recent lineage for remix/reference workflows while preventing very long sessions from retaining unbounded inline image strings.

### Non-Critical Image Hints

Apply `loading="lazy"` and `decoding="async"` to history gallery thumbnails only.

- History images are the clearest non-critical render target because they are below the active result area and not needed for first paint of the current workflow.
- Keep the current result grid, selected remix panel image, and active generation imagery on default loading behavior so the primary interaction path does not change.
- Do not switch to `next/image` in this round; the current component renders flexible raw `<img>` elements and often uses inline data URLs.

## Error Handling

- Keep the current abort and timeout behavior unchanged.
- Keep the current full-failure behavior unchanged: if no image is produced, surface the first request error or the existing fallback error.
- For input-image runs, ordinary batch failures and short batches should fall back to the single-image top-up loop within the remaining attempt budget.
- Final short results should still surface the partial-warning toast path.

## Testing Plan

### New Behavior-Level Coverage

Add focused helper/source tests that match the repository's current testing style:

- `tests/image-studio-adaptive-request-strategy.test.ts`
  - verifies text-only `total=3` uses request sequence `[1, 1, 1]`
  - verifies input-image `total=3` uses `[3]` when the first batch is full
  - verifies input-image `total=3` uses `[3, 1, 1]` when the first batch is short
  - verifies input-image `total=2` uses `[2, 1, 1]` when the first batch throws an ordinary error
  - verifies abort/timeout-style control errors still stop immediately without fallback
- `tests/image-studio-history-window.test.ts`
  - verifies `IMAGE_STUDIO_HISTORY_LIMIT = 6`
  - verifies history insertion slices to that shared cap and preserves duplicate guarding
  - verifies history thumbnails render with `loading="lazy"` and `decoding="async"`

### Regression Verification

Re-run existing focused tests that cover adjacent behavior:

- `tests/image-studio-missing-api-key-dialog.test.ts`
- `tests/image-studio-remember-key-dialog.test.ts`
- `tests/image-studio-stop-timeout-controls.test.ts`
- `tests/image-studio-history-keys.test.ts`
- `tests/image-studio-requested-summary.test.ts`
- `tests/image-route-debug-summary.test.ts`
- `tests/image-route-edit-input-fidelity.test.ts`
- `tests/image-route-reported-fields.test.ts`
- `tests/image-route-timeout.test.ts`

## Risks

- If the branch condition checks only `uploads.length`, remix runs that rely on `activeSource` will miss the batched path and keep re-uploading.
- If batching logic duplicates metadata assignment instead of sharing it, text-only and input-image results can diverge in debug, quality, or size reporting.
- If the history cap runs before the duplicate guard, repeated state transitions could evict a unique entry unnecessarily.
- If lazy-loading is applied to the current result area instead of history thumbnails, the main generation workflow could feel slower.

## Files Expected To Change

- `src/lib/image-studio-generation.ts`
- `src/components/image-studio.tsx`
- `tests/image-studio-adaptive-request-strategy.test.ts`
- `tests/image-studio-history-window.test.ts`
- `docs/superpowers/specs/2026-05-25-image-generation-performance-design.md`
- `docs/superpowers/plans/2026-05-25-image-generation-performance.md`

## Files Expected Not To Change

- `src/app/api/images/route.ts`
- `src/lib/image-request.ts`
