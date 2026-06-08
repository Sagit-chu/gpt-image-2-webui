# Concurrent Multi-Task Image Generation Design

## Goal

Add true multi-task image generation to the existing Next.js/React image studio so a user can submit multiple generation tasks, choose a frontend `max concurrent tasks` value, watch queued and running work independently, stop or remove individual tasks without affecting others, and compare completed, partial, failed, stopped, or timed-out task results in the result area.

The MVP stays in the browser. It does not add a database, a backend queue, a new image route, or server-side concurrency controls. The existing provider/API layer remains responsible for upstream rate limits and concurrency limits.

## Non-Goals

- No backend job queue, database persistence, worker process, polling API, or resumable server job model.
- No server-side concurrency guard for the MVP; upstream provider and API limits remain authoritative.
- No major rewrite of `/api/images`, `runImageStudioSession()`, `executeImageStudioRequestStrategy()`, or `callImageStudioProxy()`.
- No persisted queued or running task recovery after reload because API keys and `File` objects must remain in memory only.
- No storage of task API keys in generation history, debug panels, task export, local storage, or visible task metadata.
- No redesign of the full studio layout beyond adding concurrency control and a task queue/list in the result area.
- No change to existing model/request behavior beyond per-task snapshotting and scheduling.

## Current Architecture Summary

The app is a Next.js App Router project with a client-heavy image studio in `src/components/image-studio.tsx` and a Node.js API route in `src/app/api/images/route.ts`.

- `ImageStudio` owns form state for prompt, references, model, endpoint, API key, output settings, timeout, locale, current result, history, selected image, upload previews, active remix source, progress, and a single generation abort/timeout lifecycle.
- `startGeneration()` validates prompt/API key/custom size, optionally prompts to remember keys, creates one `AbortController`, starts one timeout, clears the current result, calls `runImageStudioSession()`, publishes partial images through `onImagesUpdated`, then updates the single `result` and bounded `history`.
- `runImageStudioSession()` calls `executeImageStudioRequestStrategy()` and delegates each proxy request to `callImageStudioProxy()`.
- `executeImageStudioRequestStrategy()` currently chooses the request strategy: text-only tasks fan out single-image requests, while input-image tasks start with a batched request and top up with single-image requests if needed.
- `callImageStudioProxy()` builds `FormData` and posts to `/api/images` using the provided `AbortSignal` and timeout value.
- `/api/images` validates form fields and uploaded files, selects generate vs edit based on whether images are present, calls the OpenAI SDK with `timeout` and `request.signal`, materializes generated images, and returns images plus debug/request metadata.
- Existing generation history is in-memory only and capped through `IMAGE_STUDIO_HISTORY_LIMIT` when prior results move into `history`.

The current single-generation model is the main constraint: one global `isGenerating`, `progress`, `generationStartedAt`, `result`, `selectedImageIndex`, `generationAbortControllerRef`, and `generationTimeoutRef` cannot represent independent queued/running/completed tasks.

## Proposed Architecture

Introduce an in-memory frontend task scheduler inside `ImageStudio`, backed by immutable task snapshots and per-task runtime state. Keep the existing session/proxy/API route pipeline intact by having each running task call `runImageStudioSession()` with its own snapshot, `AbortController`, timeout, and progress callbacks.

Core changes:

- Replace the single active generation runtime with `tasks`, `selectedTaskId`, and per-task runtime refs keyed by task id.
- Add a user-facing `max concurrent tasks` control in the left settings/sidebar near generation controls. Clamp the value to a small MVP range, recommended `1..4`, with default `1` to preserve existing behavior until the user opts into concurrency.
- On submit, create a new immutable task snapshot from the current form, prompt, reference files, active source, locale, endpoint, API key, and derived request prompt. Enqueue it rather than replacing the current result.
- A scheduler effect starts queued tasks while `runningCount < maxConcurrentTasks`.
- A running task calls `runImageStudioSession()` exactly as the current `startGeneration()` does, using its snapshot values instead of live form state.
- Each task owns status, progress, images, selected image index, error message, partial metadata, endpoint/quality/size reporting, debug, started/completed timestamps, abort controller, and timeout.
- Selecting a task in the result-area task list drives the result grid, summary footer, debug panel, and iteration/remix panel.
- Existing iteration/remix actions operate on the selected task result. They stage the selected task image as the active source for a future task, without mutating the selected task.

This keeps the established request path intact:

`Task snapshot -> runImageStudioSession() -> executeImageStudioRequestStrategy() -> callImageStudioProxy() -> /api/images -> provider`.

## Task Data Model

Each task is split into immutable submitted data and mutable runtime/result data. API keys remain in memory and are excluded from serializable result/history/debug/export shapes.

Small type sketch:

```ts
type ImageTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "stopped"
  | "timedOut"

type ImageTaskSnapshot = {
  id: string
  submittedAt: number
  generation: number
  prompt: string
  requestPrompt: string
  references: readonly File[]
  referenceNames: readonly string[]
  model: string
  apiKey: string
  apiKeySet: boolean
  endpoint: string
  outputFormat: string
  background: string
  quality: string
  size: string
  imageCount: number
  timeoutMs: number
  locale: Locale
  sourceLabel?: string
}

type ImageTask = {
  snapshot: ImageTaskSnapshot
  status: ImageTaskStatus
  progress: number
  images: GeneratedImage[]
  selectedImageIndex: number
  endpoint: string
  quality: string
  qualityReported: boolean
  size: string
  sizeReported: boolean
  debug: StudioDebug | null
  errorMessage: string | null
  partialErrorMessage: string | null
  startedAt: number | null
  completedAt: number | null
}
```

Snapshot requirements:

- `prompt` is the user-visible prompt at submit time, trimmed and immutable.
- `requestPrompt` is the derived prompt after applying the active source/remix instruction through the current `buildRequestPrompt(prompt, activeSource)` behavior.
- `references` contains the exact `File` objects that should be sent, including the active source upload followed by current reference uploads. Later reference removal or active source changes must not affect already-submitted tasks.
- `referenceNames` is safe display/debug metadata and can be included in task UI/history/debug.
- `apiKey` is used only while the task is queued or running in memory. It must be stripped before adding any snapshot to history, debug output, or exportable task metadata.
- `apiKeySet` is the only UI-safe key metadata. It supports labels such as `Key set` without exposing the key value.
- `model`, `endpoint`, `locale`, output settings, image count, and timeout are captured at submit time so different queued/running tasks can use different model/API key/endpoint values.

Recommended internal split:

- Keep `snapshot.apiKey` inside `ImageTask` only for queued/running execution.
- When a task reaches a terminal state, replace the stored snapshot with a sanitized copy or set an internal `apiKey` field to an empty string after the request no longer needs it.
- Build `StudioResponse` history entries from sanitized task result snapshots only.

## Scheduler Behavior

The scheduler is a frontend-only queue. It should be deterministic, simple, and independent from provider-level throttling.

- `maxConcurrentTasks` is configurable by the user and defaults to `1`.
- The scheduler starts queued tasks in submission order while the number of running tasks is below the configured limit.
- Reducing `maxConcurrentTasks` does not stop already-running tasks. It only prevents additional queued tasks from starting until running count falls below the new limit.
- Increasing `maxConcurrentTasks` starts more queued tasks on the next scheduler pass.
- Each task starts its timeout only when it transitions from `queued` to `running`, not when it is submitted.
- Each task gets its own `AbortController`, timeout id, and elapsed-time basis.
- `onImagesUpdated` updates only that task's `images`, `progress`, and selected-index bounds.
- `onProxyResult` updates only that task's debug, endpoint, quality, qualityReported, size, and sizeReported metadata.
- When a task reaches `completed`, `partial`, `failed`, `stopped`, or `timedOut`, the scheduler clears that task's timeout/controller refs, sanitizes its API key, and starts the next queued task if capacity is available.
- Stopping one running task aborts only that task's controller. Other running tasks continue, queued tasks are not aborted, and the scheduler may start the next queued task after the stopped task reaches a terminal state.
- Removing one queued task deletes only that task. It must not affect running tasks or completed results.

Scheduler implementation can stay in `ImageStudio` for the MVP, but the core transitions should be small helper functions where practical to make source-level tests possible:

- `createImageTaskSnapshot(...)` to freeze the current form/source state.
- `sanitizeTaskForHistory(task)` or equivalent to create key-free result snapshots.
- `getNextRunnableTaskIds(tasks, maxConcurrentTasks)` to enforce FIFO and concurrency caps.
- `isTerminalTaskStatus(status)` to centralize completed/partial/failed/stopped/timedOut checks.

## UI/UX Changes

### Concurrency Control

Add a `max concurrent tasks` setting near the existing image count/timeout controls.

- Use a small numeric input, select, or toggle group for `1`, `2`, `3`, `4`.
- Default to `1`.
- Persisting this preference in local storage is optional for MVP. If persisted, store only the number, never task snapshots or API keys.
- Label copy should make clear this controls browser-side task starts, while the API/provider may still rate-limit requests.

### Submission Behavior

The primary generate button submits a new task instead of replacing the current result.

- If prompt/custom-size/API-key validation fails, do not create a task.
- Existing missing-key and remember-key dialogs should still gate submission before a task is created.
- After task creation, keep the form editable. Later submissions create separate snapshots and can use different prompt, references, model, API key, endpoint, locale, output settings, image count, and timeout.
- Select the newly submitted task by default so the user sees it enter `queued` or `running` immediately.

### Task Queue/List

Add a task queue/list in the result area, above or beside the result grid depending on available width.

Each row/card should show:

- Short prompt preview from `snapshot.prompt`.
- Status badge: `queued`, `running`, `completed`, `partial`, `failed`, `stopped`, or `timedOut`.
- Progress for running tasks and generated count for result-bearing tasks, such as `2 / 4`.
- Model, size, output format, image count, reference count, endpoint host or truncated endpoint, and `Key set` or `No key` metadata.
- Started/elapsed time for running tasks and completed timestamp or duration for terminal tasks.
- `Stop` action for running tasks.
- `Remove` action for queued tasks.
- Selection affordance that makes the task drive the main result view.

Completed, partial, failed, stopped, and timed-out tasks remain visible for comparison. A later cleanup action such as `Clear completed` can be added after MVP, but it is not required.

### Selected Task Result View

The main result grid should render from the selected task rather than a global `result`.

- `queued`: show a queued empty/pending state with position in queue and the task snapshot summary.
- `running` with no images yet: show existing skeleton cards using that task's `imageCount`.
- `running` with images: show generated images plus pending skeleton cards for the remaining count.
- `completed`: show all images and success metadata.
- `partial`: show available images plus an inline partial-success callout containing the generated count, requested count, and first/partial error message when available.
- `failed`: show an inline failure callout with the error and task summary.
- `stopped`: if images exist, show them with an inline stopped-partial callout; otherwise show stopped state.
- `timedOut`: if images exist, show them with an inline timed-out-partial callout; otherwise show timed-out state.

Toasts can remain for immediate feedback, but partial success must be visible inline on the task itself, not only as a toast.

### Iteration And Remix

Preserve existing iteration/remix behavior by operating on the selected task's selected image.

- `selectedImageIndex` becomes per-task state.
- `RemixPanel` receives `selectedTask.images[selectedTask.selectedImageIndex]`.
- `setGeneratedImageAsSource()` reads from the selected task result, stages that image as the active source, and keeps the source label tied to the selected task generation/asset.
- Starting a follow-up generation creates a new task snapshot from the active source and current form state. It does not mutate the parent task.

### History

Existing generation history should continue with the current cap and should be fed by completed/partial task result snapshots.

- Add history entries when a task reaches `completed` or `partial` with at least one image.
- Do not add `failed`, `queued`, `running`, `stopped` without images, or `timedOut` without images to history.
- For `stopped` or `timedOut` with images, the recommended MVP behavior is to keep them visible in the task list but not add them to generation history unless product copy explicitly treats them as partial successes. This avoids mixing user-aborted/interrupted work into normal generation lineage.
- Keep the existing `IMAGE_STUDIO_HISTORY_LIMIT` cap and duplicate guard by stable id.
- History entries must be sanitized: no API key, no raw task snapshot with `apiKey`, no secret-bearing debug.

## Data Flow

### Submit To Queue

1. User edits form state, references, active source, locale, endpoint, and API key.
2. User clicks generate.
3. Existing validation runs: prompt required, custom size valid, API key present or missing-key dialog resolves, remember-key prompt resolves.
4. `ImageStudio` builds `inputUploads` from active source plus current reference uploads.
5. `ImageStudio` creates an immutable task snapshot, including `requestPrompt = buildRequestPrompt(prompt, activeSource)`.
6. The new task is appended to `tasks` with status `queued`, progress `0`, empty images, selected image index `0`, and sanitized visible metadata.
7. The task becomes selected.

### Queue To Running

1. Scheduler computes running task count.
2. Scheduler selects queued tasks in FIFO order until capacity is reached.
3. For each selected task, create a fresh `AbortController`, store it in a task runtime ref map, create a timeout based on that task's `timeoutMs`, and set status to `running`, progress to an initial value such as `8`, and `startedAt = Date.now()`.
4. Start `runImageStudioSession()` with snapshot values.

### Running To Terminal

1. `runImageStudioSession()` publishes images through `onImagesUpdated`; the task updates partial images and progress.
2. Proxy metadata updates through `onProxyResult`; the task updates endpoint, debug, quality, and size metadata.
3. If the session returns no images, mark `failed` with `firstError` or the existing `allRequestsFailed` fallback.
4. If the session returns images and `isPartial` is false, mark `completed`, progress `100`, and append a sanitized `StudioResponse` to history.
5. If the session returns images and `isPartial` is true, mark `partial`, progress `100`, save `partialErrorMessage`, show inline partial callout, and append a sanitized `StudioResponse` to history.
6. If the task abort controller receives a stop reason, mark `stopped`. Keep any images already published on that task.
7. If the task timeout fires, abort the task controller with a timeout reason and mark `timedOut`. Keep any images already published on that task.
8. Clear the task timeout/controller refs and sanitize the task API key.
9. Scheduler starts the next queued task if capacity exists.

## Error, Abort, And Timeout Behavior

### Errors

- Ordinary request failures inside `executeImageStudioRequestStrategy()` continue to behave as today: collect first error, continue eligible top-up attempts, and return partial images if any succeed.
- A task with zero images after all attempts becomes `failed` and stores a user-facing `errorMessage`.
- A task with some images but fewer than requested becomes `partial` and stores `partialErrorMessage` from `firstError` when present.
- Failed and partial messages are displayed inline in the selected task result view. Toasts can supplement the inline state but cannot be the only user-visible record.

### Abort

- Each running task has an independent `AbortController`.
- Clicking `Stop` on a running task aborts only that task's controller with the existing `GenerationAbortError` pattern or equivalent per-task control error.
- Other running tasks continue unaffected.
- Queued tasks do not have controllers yet. They can be removed without aborting anything.
- Component unmount aborts all running task controllers and clears all task timeouts.

### Timeout

- Timeout starts when a task transitions to `running`.
- Time spent in `queued` status does not count against the task timeout.
- Timeout uses the task snapshot's `timeoutMs`, so tasks submitted with different timeout settings behave independently.
- A timed-out task keeps images that arrived before timeout and displays `timedOut` with partial result messaging when applicable.
- Timeout cleanup must only clear the timed-out task's timeout id and controller ref.

## Security And Privacy

### API Keys

- Task API keys are in memory only.
- Task API keys must never be persisted into generation history, debug panels, task export, local storage task state, URLs, or visible metadata.
- The UI may show only `Key set`/`No key` style metadata per task.
- Existing remembered-key behavior can continue storing the user's connection preference when they explicitly choose it, but task queue persistence must not store per-task keys.
- When a task reaches a terminal state, clear its in-memory API key as soon as it is no longer needed for execution.

### Files And Images

- Queued/running tasks retain `File` objects in memory only so each task uses the submitted reference snapshot.
- Queued/running tasks are not persisted across reload because `File` objects and API keys should not be persisted.
- Generated images can remain in task state and sanitized history as they do today, subject to existing memory caps and future cleanup controls.

### Debug And Export Safety

- Existing `/api/images` debug metadata currently reports request prompt preview, endpoint, model, image count, input image names, size, quality, output format, and timeout. It should remain key-free.
- Any task export/debug-copy feature added later must use sanitized task/result shapes and exclude `snapshot.apiKey` and raw `File` objects.
- If task metadata displays endpoints, prefer truncated UI display and never include credentials in endpoints. Endpoint normalization should reject invalid URLs as it does today.

### Custom Endpoint And Server Environment Key Hardening

There is a companion security risk in the existing server route: `/api/images` falls back to `process.env.OPENAI_API_KEY` when the request form does not include `apiKey`, while also accepting a user-supplied `endpoint`. Without server-side endpoint validation, a server environment key could be sent to an arbitrary custom endpoint.

Recommended companion change, ideally in the same implementation if feasible:

- Add server-side endpoint allowlist/validation before constructing the OpenAI client when the effective API key comes from `OPENAI_API_KEY`.
- Treat the default OpenAI endpoint as trusted.
- Require a user-provided API key for custom endpoints unless the endpoint is explicitly trusted by server configuration.
- If `OPENAI_API_KEY` would be used with an untrusted custom endpoint, reject the request with a clear `400` error instead of sending the server key upstream.
- Keep this validation in `/api/images`, not only in the client, because the route is the trust boundary.

This hardening is not a concurrency requirement, but it should be included with the MVP if implementation time allows because multi-task submission increases the number of opportunities to accidentally route secret-bearing requests.

## Testing Strategy

Use focused source-level and behavior-level tests matching the existing repository style. The current project uses TypeScript test files under `tests/` with Node assertions, plus Playwright for browser coverage.

### Scheduler And Data Model Tests

- Verify `getNextRunnableTaskIds()` starts at most `maxConcurrentTasks` queued tasks and preserves FIFO order.
- Verify reducing concurrency does not select additional tasks when running count is already at or above the new limit.
- Verify increasing concurrency selects additional queued tasks.
- Verify queued task timeout is not created until the task starts running.
- Verify per-task selected image index stays bounded when partial images arrive.
- Verify terminal task sanitization removes API keys while preserving `apiKeySet` metadata.

### Session Integration Tests

- Extend or add tests around `runImageStudioSession()` usage to verify two tasks can pass different model, endpoint, API key, timeout, image count, and prompt values into separate proxy calls.
- Verify stopping one task aborts only that task's signal and a second running task's signal remains un-aborted.
- Verify timed-out task marks `timedOut` and does not change another running task.
- Verify partial task results include inline-readable error state in task data, not only a toast path.

### UI Source/Behavior Tests

- Verify the UI includes a `max concurrent tasks` control and uses default `1`.
- Verify task list statuses include `queued`, `running`, `completed`, `partial`, `failed`, `stopped`, and `timedOut` copy.
- Verify running task rows expose `Stop` and queued task rows expose `Remove`.
- Verify selecting a task drives the result grid, summary metadata, debug panel, selected image, and remix panel.
- Verify completed/partial task results are added to bounded history and key-free history snapshots.
- Verify API keys are not rendered in task rows, result summaries, debug panels, or history.

### Route Security Tests

If the companion endpoint hardening is implemented with the MVP:

- Verify server `OPENAI_API_KEY` can be used with the default OpenAI endpoint.
- Verify server `OPENAI_API_KEY` is rejected for an arbitrary custom endpoint.
- Verify a user-provided API key can be used with a custom endpoint.
- Verify explicitly trusted custom endpoints can use the server key only when configured as trusted.

### Regression Tests

- Keep existing session strategy tests passing for text-only fan-out and input-image batched/top-up behavior.
- Keep existing API-key dialog and remember-key behavior passing.
- Keep existing timeout, debug summary, requested summary, route reported fields, and history cap behavior passing.
- Run `pnpm lint` and the relevant `tsx tests/...` files. Run Playwright only for browser-critical UI checks or if the implementation changes interactions that source tests cannot cover.

## Rollout And Risks

### Rollout

- Ship with `max concurrent tasks` defaulting to `1` so existing behavior remains familiar.
- Keep the existing `/api/images` contract and request helpers to reduce backend risk.
- Add task queue UI behind the normal result area rather than a separate page.
- Prefer small helper functions for scheduler transitions so implementation can be tested without driving the full UI.
- Include the server-key/custom-endpoint hardening in the same implementation when feasible; otherwise document it as the next security task before recommending custom endpoint use with server environment keys.

### Risks

- Holding multiple queued tasks with `File` references and generated data URLs can increase memory use. Mitigate by keeping the MVP concurrency cap small and preserving bounded history.
- If task snapshots accidentally read live form state while running, queued tasks may use the wrong model, endpoint, API key, references, locale, or output settings. Mitigate by passing only snapshot values to `runImageStudioSession()`.
- If a global abort/timeout ref remains in use, stopping or timing out one task could affect other tasks. Mitigate by keying controllers and timeouts by task id.
- If API key sanitization happens too late or only in UI rendering, secrets can leak into debug/history/export state. Mitigate by using sanitized task/result builders at terminal transitions.
- If partial success remains toast-only, users can lose task outcome details after comparing multiple tasks. Mitigate with inline partial/stopped/timed-out callouts in the selected task result view.
- If completed task history is updated from non-pure React state updaters, Strict Mode can duplicate history entries. Preserve the existing duplicate guard and keep history insertion logic explicit.
- If `OPENAI_API_KEY` can be combined with arbitrary custom endpoints, server secrets can be exfiltrated. Mitigate with server-side endpoint allowlist/validation in `/api/images`.

## Implementation Boundaries

Files expected to change in a future implementation plan:

- `src/components/image-studio.tsx` for task state, scheduler, queue UI, per-task result rendering, and per-task abort/timeout behavior.
- `src/lib/image-studio-generation.ts` or a new focused helper under `src/lib/` for scheduler/status/sanitization helpers if extracting them keeps tests small.
- `src/lib/i18n.ts` for new task/concurrency/status/error copy across supported locales.
- `src/app/api/images/route.ts` for the recommended server-key/custom-endpoint hardening.
- Tests under `tests/` for scheduler behavior, UI source checks, session isolation, sanitization, and route security.

Files expected to remain mostly intact:

- `src/lib/image-studio-session.ts` should continue exposing `runImageStudioSession()` with the same core options.
- `src/lib/image-studio-proxy.ts` should continue posting the same form fields to `/api/images`.
- `src/lib/image-request.ts` should continue normalizing endpoints and materializing generated images, except if endpoint trust helpers are factored there for reuse.
- `/api/images` should keep its request/response contract except for rejecting unsafe server-key/custom-endpoint combinations.
