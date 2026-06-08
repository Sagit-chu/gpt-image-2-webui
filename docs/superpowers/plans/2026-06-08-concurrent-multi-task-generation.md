# Concurrent Multi-Task Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add true browser-side concurrent image generation tasks with per-task snapshots, scheduling, progress, results, stop/remove controls, timeout handling, history integration, and server-key endpoint hardening.

**Architecture:** Keep the existing request pipeline intact: `ImageTaskSnapshot -> runImageStudioSession() -> executeImageStudioRequestStrategy() -> callImageStudioProxy() -> /api/images`. Add a small pure task helper for scheduler/status/sanitization logic, then refactor `ImageStudio` from singleton generation state into an in-memory task queue keyed by task id. Harden `/api/images` so the server `OPENAI_API_KEY` is used only with the default OpenAI endpoint or explicitly trusted server-configured endpoints.

**Tech Stack:** Next.js 16 App Router, React 19 client components, TypeScript, OpenAI SDK, pnpm 10, source-level `tsx` tests, Playwright browser tests.

---

## File Map

- Create `src/lib/image-studio-tasks.ts`: Pure task types and helpers for statuses, concurrency selection, selected-image bounds, snapshot creation, runtime-free queued task creation, API-key sanitization, and history-result creation.
- Create `tests/image-studio-tasks.test.ts`: Node/source tests for FIFO scheduling, concurrency clamps, selected-image bounds, immutable snapshot contents, terminal status detection, and key-free history conversion.
- Create `src/lib/image-endpoint-trust.ts`: Server-side base URL trust helpers used by `/api/images` when a request would fall back to `process.env.OPENAI_API_KEY`.
- Create `tests/image-route-endpoint-trust.test.ts`: Route trust-boundary tests for default endpoint, arbitrary custom endpoint, user-provided custom endpoint key, and server allowlisted custom endpoint.
- Modify `src/app/api/images/route.ts`: Split user-provided vs server-provided API key selection and reject server-key use for untrusted custom endpoints before constructing the OpenAI client.
- Modify `src/components/image-studio.tsx`: Replace singleton generation runtime with task state, selected task state, per-task refs, queue scheduler, task list UI, selected-task result rendering, per-task stop/remove, per-task timeout, and selected-task remix integration.
- Modify `src/lib/i18n.ts`: Add task queue, concurrency, status, stop/remove, partial, failure, stopped, and timed-out inline copy for all locales. Locales that spread `en` can inherit unchanged English strings where the file already uses that pattern.
- Modify `tests/image-studio-stop-timeout-controls.test.ts`: Replace singleton abort/timeout source checks with per-task controller and timeout map checks.
- Modify `tests/image-studio-history-window.test.ts`: Replace singleton `result` source checks with selected-task/history-result checks while keeping the shared cap and lazy history thumbnail assertions.
- Modify `tests/image-studio-history-keys.test.ts`: Assert task/history conversion remains key-free and stable-id based.
- Create `tests/image-studio-task-source.test.ts`: Source-level checks that `ImageStudio` imports task helpers, owns task queue state, uses selected task result state, and no longer disables submission globally while a task is running.
- Create `tests/image-studio-task-copy.test.ts`: Source-level checks that all task statuses and required UI copy keys exist in `StudioMessages` and are referenced by the task UI.
- Modify `tests/browser/image-studio-smoke.spec.ts`: Add browser coverage for multi-task submission, configured concurrency, queued removal, per-task stop isolation, selected-task result rendering, partial inline state, and key non-disclosure.
- Modify `tests/browser/image-studio-test-helpers.ts`: Add task-list selectors only if the browser tests need stable helpers; keep existing helpers compatible with the new selected-task result grid.
- Keep mostly intact `src/lib/image-studio-session.ts`, `src/lib/image-studio-generation.ts`, and `src/lib/image-studio-proxy.ts`: Do not change their public request behavior unless a focused test proves a small type-only or callback seam is required.

## Implementation Notes

- Before touching `src/app/api/images/route.ts`, read these Next.js 16 docs because `AGENTS.md` says this is not the familiar Next.js version: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
- Use `pnpm` for every package script.
- Use `pnpm exec tsx tests/<file>.test.ts` for focused source tests.
- Use `pnpm exec playwright test tests/browser/image-studio-smoke.spec.ts -g "<test name>"` for focused browser tests.
- Commit steps below are checkpoints. Run them only when the main coordinator or user has authorized commits for the implementation run; otherwise leave changes uncommitted and report the skipped checkpoint.
- Queued/running tasks are memory-only. Do not add localStorage, sessionStorage, URL, IndexedDB, or history persistence for task snapshots.
- API keys must stay out of task UI, debug JSON, history entries, exports, route debug payloads, and source-test fixtures.

---

### Task 0: Preflight And Baseline

**Files:**
- Read: `docs/superpowers/specs/2026-06-08-concurrent-multi-task-generation-design.md`
- Read: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- Read: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`

- [ ] **Step 1: Verify the required Next.js docs exist**

Run: `test -f node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md && test -f node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`

Expected: exit code `0`.

- [ ] **Step 2: Read the route handler docs before route edits**

Read with the agent file-read tool:

```text
node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
```

Expected: implementer can state that `src/app/api/images/route.ts` remains a Node.js App Router route handler exporting `POST`, `runtime = "nodejs"`, and `maxDuration`.

- [ ] **Step 3: Run current focused tests for baseline signal**

Run: `pnpm exec tsx tests/image-studio-session.test.ts && pnpm exec tsx tests/image-studio-adaptive-request-strategy.test.ts && pnpm exec tsx tests/image-route-reported-fields.test.ts`

Expected: all three commands pass before feature edits. If an unrelated baseline failure exists, record the failing command and continue only after the main coordinator confirms the baseline status.

- [ ] **Step 4: Check working tree without modifying files**

Run: `git status --short`

Expected: note existing changed files. Do not revert or overwrite unrelated changes.

---

### Task 1: Pure Task Scheduler And Sanitization Helper

**Files:**
- Create: `src/lib/image-studio-tasks.ts`
- Create: `tests/image-studio-tasks.test.ts`

- [ ] **Step 1: Write the failing helper test**

Create `tests/image-studio-tasks.test.ts` with assertions for the helper contract:

```ts
import assert from "node:assert/strict"

import {
  clampMaxConcurrentTasks,
  createHistoryResultFromTask,
  createImageTaskSnapshot,
  createQueuedImageTask,
  getNextRunnableTaskIds,
  isTerminalTaskStatus,
  sanitizeImageTaskSnapshot,
  updateTaskImages,
  type ImageTask,
} from "../src/lib/image-studio-tasks"

const reference = new File(["reference-bytes"], "reference.png", { type: "image/png" })

function makeTask(id: string, status: ImageTask["status"]): ImageTask {
  return {
    ...createQueuedImageTask(createImageTaskSnapshot({
      apiKey: `sk-${id}`,
      background: "auto",
      endpoint: `https://${id}.example.test/v1`,
      generation: 1,
      id,
      imageCount: 3,
      locale: "en",
      model: `model-${id}`,
      outputFormat: "png",
      prompt: ` prompt ${id} `,
      quality: "high",
      references: [reference],
      requestPrompt: `request prompt ${id}`,
      size: "1024x1024",
      submittedAt: 100 + id.charCodeAt(0),
      timeoutMs: 12_000,
    })),
    status,
  }
}

const tasks = [makeTask("a", "queued"), makeTask("b", "running"), makeTask("c", "queued"), makeTask("d", "queued")]

assert.equal(clampMaxConcurrentTasks(0), 1)
assert.equal(clampMaxConcurrentTasks(5), 4)
assert.equal(clampMaxConcurrentTasks(2), 2)
assert.deepEqual(getNextRunnableTaskIds(tasks, 1), [])
assert.deepEqual(getNextRunnableTaskIds(tasks, 2), ["a"])
assert.deepEqual(getNextRunnableTaskIds(tasks, 4), ["a", "c", "d"])

const snapshot = createImageTaskSnapshot({
  apiKey: "sk-secret-value",
  background: "transparent",
  endpoint: "https://api.example.test/v1",
  generation: 2,
  id: "snapshot-id",
  imageCount: 4,
  locale: "en",
  model: "model-snapshot",
  outputFormat: "webp",
  prompt: "  visible prompt  ",
  quality: "medium",
  references: [reference],
  requestPrompt: "derived request prompt",
  size: "2048x2048",
  sourceLabel: "Source image ready",
  submittedAt: 123,
  timeoutMs: 99_000,
})

assert.equal(snapshot.prompt, "visible prompt")
assert.equal(snapshot.requestPrompt, "derived request prompt")
assert.deepEqual(snapshot.referenceNames, ["reference.png"])
assert.equal(snapshot.apiKey, "sk-secret-value")
assert.equal(snapshot.apiKeySet, true)

const sanitized = sanitizeImageTaskSnapshot(snapshot)
assert.equal(sanitized.apiKey, "")
assert.equal(sanitized.apiKeySet, true)
assert.deepEqual(sanitized.referenceNames, ["reference.png"])

const bounded = updateTaskImages(makeTask("bounded", "running"), [
  { src: "data:image/png;base64,one" },
])
assert.equal(bounded.selectedImageIndex, 0)

const completed = {
  ...makeTask("history", "completed"),
  endpoint: "https://api.openai.com/v1/images/generations",
  images: [{ revisedPrompt: "revised", src: "data:image/png;base64,one" }],
  progress: 100,
  quality: "high",
  qualityReported: true,
  size: "1024x1024",
  sizeReported: false,
} satisfies ImageTask

const historyResult = createHistoryResultFromTask(completed)
assert.ok(historyResult)
assert.equal(historyResult.id, "history")
assert.equal(historyResult.prompt, "prompt history")
assert.equal(historyResult.requestedCount, 3)
assert.doesNotMatch(JSON.stringify(historyResult), /sk-/)

assert.equal(isTerminalTaskStatus("queued"), false)
assert.equal(isTerminalTaskStatus("running"), false)
assert.equal(isTerminalTaskStatus("completed"), true)
assert.equal(isTerminalTaskStatus("partial"), true)
assert.equal(isTerminalTaskStatus("failed"), true)
assert.equal(isTerminalTaskStatus("stopped"), true)
assert.equal(isTerminalTaskStatus("timedOut"), true)
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run: `pnpm exec tsx tests/image-studio-tasks.test.ts`

Expected: failure mentioning `Cannot find module '../src/lib/image-studio-tasks'` or missing exported task helpers.

- [ ] **Step 3: Create the minimal helper implementation**

Create `src/lib/image-studio-tasks.ts` with these exported names and shapes:

```ts
import { type Locale } from "@/lib/i18n"
import { type GeneratedImage } from "@/lib/image-request"

export type ImageTaskStatus = "queued" | "running" | "completed" | "partial" | "failed" | "stopped" | "timedOut"

export type ImageTaskSnapshot = {
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

export type ImageTask<TDebug = unknown> = {
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
  debug: TDebug | null
  errorMessage: string | null
  partialErrorMessage: string | null
  startedAt: number | null
  completedAt: number | null
}

export type CreateImageTaskSnapshotInput = Omit<ImageTaskSnapshot, "apiKeySet" | "prompt" | "referenceNames"> & {
  prompt: string
}

export type ImageTaskHistoryResult<TDebug = unknown> = {
  endpoint: string
  id: string
  generation: number
  debug?: TDebug | null
  images: GeneratedImage[]
  model: string
  outputFormat: string
  prompt: string
  quality: string
  qualityReported: boolean
  requestedCount: number
  size: string
  sizeReported: boolean
  sourceLabel?: string
}
```

Required helper behavior:

```ts
export function clampMaxConcurrentTasks(value: number) {
  return Math.min(4, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)))
}

export function getNextRunnableTaskIds(tasks: readonly ImageTask[], maxConcurrentTasks: number) {
  const capacity = clampMaxConcurrentTasks(maxConcurrentTasks) - tasks.filter((task) => task.status === "running").length
  return capacity <= 0
    ? []
    : tasks.filter((task) => task.status === "queued").slice(0, capacity).map((task) => task.snapshot.id)
}

export function isTerminalTaskStatus(status: ImageTaskStatus) {
  return status === "completed" || status === "partial" || status === "failed" || status === "stopped" || status === "timedOut"
}
```

Add these helper implementations after the status helpers:

```ts
export function createImageTaskSnapshot(input: CreateImageTaskSnapshotInput): ImageTaskSnapshot {
  const references = [...input.references]
  return {
    ...input,
    apiKeySet: Boolean(input.apiKey.trim()),
    prompt: input.prompt.trim(),
    referenceNames: references.map((file) => file.name),
    references,
  }
}

export function createQueuedImageTask<TDebug = unknown>(snapshot: ImageTaskSnapshot): ImageTask<TDebug> {
  return {
    snapshot,
    status: "queued",
    progress: 0,
    images: [],
    selectedImageIndex: 0,
    endpoint: snapshot.endpoint,
    quality: snapshot.quality,
    qualityReported: false,
    size: snapshot.size,
    sizeReported: false,
    debug: null,
    errorMessage: null,
    partialErrorMessage: null,
    startedAt: null,
    completedAt: null,
  }
}

export function sanitizeImageTaskSnapshot(snapshot: ImageTaskSnapshot): ImageTaskSnapshot {
  return { ...snapshot, apiKey: "" }
}

export function updateTaskImages<TDebug>(task: ImageTask<TDebug>, images: GeneratedImage[]): ImageTask<TDebug> {
  const boundedIndex = Math.min(task.selectedImageIndex, Math.max(images.length - 1, 0))
  return { ...task, images, selectedImageIndex: boundedIndex }
}

export function createHistoryResultFromTask<TDebug>(task: ImageTask<TDebug>): ImageTaskHistoryResult<TDebug> | null {
  if (!task.images.length) return null

  return {
    endpoint: task.endpoint || task.snapshot.endpoint,
    id: task.snapshot.id,
    generation: task.snapshot.generation,
    debug: task.debug,
    images: task.images,
    model: task.snapshot.model,
    outputFormat: task.snapshot.outputFormat,
    prompt: task.snapshot.prompt,
    quality: task.quality,
    qualityReported: task.qualityReported,
    requestedCount: task.snapshot.imageCount,
    size: task.size,
    sizeReported: task.sizeReported,
    sourceLabel: task.snapshot.sourceLabel,
  }
}
```

Do not spread `task.snapshot` into `ImageTaskHistoryResult`; the returned history shape must exclude `apiKey`, `references`, and raw `File` objects.

- [ ] **Step 4: Run the helper test and verify it passes**

Run: `pnpm exec tsx tests/image-studio-tasks.test.ts`

Expected: command exits successfully.

- [ ] **Step 5: Authorized checkpoint commit**

Run only if commit authorization is active: `git add src/lib/image-studio-tasks.ts tests/image-studio-tasks.test.ts && git commit -m "feat: add image studio task helpers"`

Expected: one commit is created. If commit authorization is absent, do not commit.

---

### Task 2: Server-Key Custom Endpoint Hardening

**Files:**
- Create: `src/lib/image-endpoint-trust.ts`
- Create: `tests/image-route-endpoint-trust.test.ts`
- Modify: `src/app/api/images/route.ts`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Write the failing route hardening test**

Create `tests/image-route-endpoint-trust.test.ts`:

```ts
import assert from "node:assert/strict"

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b5mQAAAAASUVORK5CYII="

function getAuthorizationHeader(headers: HeadersInit | undefined) {
  if (!headers) return ""
  if (headers instanceof Headers) return headers.get("authorization") || ""
  if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === "authorization")?.[1] || ""
  return Object.entries(headers).find(([key]) => key.toLowerCase() === "authorization")?.[1] || ""
}

async function postImage(formData: FormData) {
  const { POST } = await import("../src/app/api/images/route")
  return POST(new Request("http://localhost/api/images", { body: formData, method: "POST" }))
}

function createFormData(endpoint: string, apiKey = "") {
  const formData = new FormData()
  if (apiKey) formData.append("apiKey", apiKey)
  formData.append("endpoint", endpoint)
  formData.append("prompt", "endpoint trust prompt")
  return formData
}

async function main() {
  const originalFetch = globalThis.fetch
  const originalServerKey = process.env.OPENAI_API_KEY
  const originalTrusted = process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS
  const upstreamCalls: Array<{ authorization: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    upstreamCalls.push({ authorization: getAuthorizationHeader(init?.headers), url })
    return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })
  }

  try {
    process.env.OPENAI_API_KEY = "sk-server-key"
    delete process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS

    const defaultResponse = await postImage(createFormData("https://api.openai.com/v1"))
    assert.equal(defaultResponse.status, 200)
    assert.equal(upstreamCalls.at(-1)?.url, "https://api.openai.com/v1/images/generations")
    assert.equal(upstreamCalls.at(-1)?.authorization, "Bearer sk-server-key")

    const rejected = await postImage(createFormData("https://untrusted.example.test/v1"))
    const rejectedPayload = await rejected.json()
    assert.equal(rejected.status, 400)
    assert.match(String(rejectedPayload.error), /custom endpoint/i)
    assert.equal(upstreamCalls.length, 1, "untrusted custom endpoint must not receive the server key")

    const userKeyResponse = await postImage(createFormData("https://untrusted.example.test/v1", "sk-user-key"))
    assert.equal(userKeyResponse.status, 200)
    assert.equal(upstreamCalls.at(-1)?.url, "https://untrusted.example.test/v1/images/generations")
    assert.equal(upstreamCalls.at(-1)?.authorization, "Bearer sk-user-key")

    process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS = "https://trusted.example.test/v1"
    const trustedResponse = await postImage(createFormData("https://trusted.example.test/v1"))
    assert.equal(trustedResponse.status, 200)
    assert.equal(upstreamCalls.at(-1)?.url, "https://trusted.example.test/v1/images/generations")
    assert.equal(upstreamCalls.at(-1)?.authorization, "Bearer sk-server-key")
  } finally {
    globalThis.fetch = originalFetch
    if (originalServerKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalServerKey
    if (originalTrusted === undefined) delete process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS
    else process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS = originalTrusted
  }
}

void main()
```

- [ ] **Step 2: Run the route hardening test and verify it fails**

Run: `pnpm exec tsx tests/image-route-endpoint-trust.test.ts`

Expected: failure because the untrusted custom endpoint receives a server-key-backed request or because `proxyServerKeyCustomEndpointBlocked` copy is missing.

- [ ] **Step 3: Add the endpoint trust helper**

Create `src/lib/image-endpoint-trust.ts`:

```ts
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n"
import { DEFAULT_OPENAI_BASE_URL, normalizeOpenAIBaseURL } from "@/lib/image-request"

export const TRUSTED_IMAGE_BASE_URLS_ENV = "OPENAI_TRUSTED_IMAGE_BASE_URLS"

export function getConfiguredTrustedImageBaseURLs(value = process.env[TRUSTED_IMAGE_BASE_URLS_ENV] || "", locale: Locale = DEFAULT_LOCALE) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeOpenAIBaseURL(item, locale))
}

export function isTrustedServerImageBaseURL(baseURL: string, trustedBaseURLs: readonly string[] = [], locale: Locale = DEFAULT_LOCALE) {
  const normalizedBaseURL = normalizeOpenAIBaseURL(baseURL, locale)
  const defaultBaseURL = normalizeOpenAIBaseURL(DEFAULT_OPENAI_BASE_URL, locale)
  return normalizedBaseURL === defaultBaseURL || trustedBaseURLs.some((trustedBaseURL) => normalizedBaseURL === normalizeOpenAIBaseURL(trustedBaseURL, locale))
}
```

- [ ] **Step 4: Add route copy for rejected server-key custom endpoints**

Modify `src/lib/i18n.ts` by adding this `en` key and localized strings for `zh`, `zh-TW`, and `ja`; locales that already spread `en` may inherit English unless the file already overrides adjacent proxy copy:

```ts
proxyServerKeyCustomEndpointBlocked: "Custom endpoints require a user-provided API key unless the endpoint is trusted by server configuration.",
```

Expected TypeScript shape: `StudioMessages` includes `proxyServerKeyCustomEndpointBlocked` for every locale.

- [ ] **Step 5: Harden `/api/images` at the trust boundary**

Modify `src/app/api/images/route.ts` so the key selection and endpoint validation happen before constructing `new OpenAI({ apiKey, baseURL, maxRetries: 0 })`:

```ts
import {
  getConfiguredTrustedImageBaseURLs,
  isTrustedServerImageBaseURL,
} from "@/lib/image-endpoint-trust"

const userApiKey = getText(incomingFormData, "apiKey")
const serverApiKey = process.env.OPENAI_API_KEY || ""
const apiKey = userApiKey || serverApiKey
const usesServerApiKey = !userApiKey && Boolean(serverApiKey)

if (!apiKey) {
  return NextResponse.json({ error: t(locale, "proxyApiKeyRequired") }, { status: 400 })
}
```

After computing `baseURL`, reject unsafe server-key use:

```ts
if (usesServerApiKey && !isTrustedServerImageBaseURL(baseURL, getConfiguredTrustedImageBaseURLs(process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS || "", locale), locale)) {
  return NextResponse.json({ error: t(locale, "proxyServerKeyCustomEndpointBlocked") }, { status: 400 })
}
```

Expected behavior: default OpenAI endpoint can use the server key; arbitrary custom endpoints require a user API key unless listed in `OPENAI_TRUSTED_IMAGE_BASE_URLS`.

- [ ] **Step 6: Run route security and existing route tests**

Run: `pnpm exec tsx tests/image-route-endpoint-trust.test.ts && pnpm exec tsx tests/image-route-reported-fields.test.ts && pnpm exec tsx tests/image-route-timeout.test.ts`

Expected: all commands pass.

- [ ] **Step 7: Authorized checkpoint commit**

Run only if commit authorization is active: `git add src/lib/image-endpoint-trust.ts src/lib/i18n.ts src/app/api/images/route.ts tests/image-route-endpoint-trust.test.ts && git commit -m "fix: harden image endpoint server key usage"`

Expected: one commit is created. If commit authorization is absent, do not commit.

---

### Task 3: Task State Source Contract In `ImageStudio`

**Files:**
- Create: `tests/image-studio-task-source.test.ts`
- Modify: `src/components/image-studio.tsx`
- Modify: `tests/image-studio-stop-timeout-controls.test.ts`
- Modify: `tests/image-studio-history-window.test.ts`
- Modify: `tests/image-studio-history-keys.test.ts`

- [ ] **Step 1: Write the failing task-state source test**

Create `tests/image-studio-task-source.test.ts`:

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(source, /from "@\/lib\/image-studio-tasks"/, "ImageStudio should use the task helper module")
assert.match(source, /const \[tasks, setTasks\] = useState<ImageTask<StudioDebug>\[\]>\(\[\]\)/, "ImageStudio should own an in-memory task list")
assert.match(source, /const \[selectedTaskId, setSelectedTaskId\] = useState<string \| null>\(null\)/, "ImageStudio should track selected task id")
assert.match(source, /const \[maxConcurrentTasks, setMaxConcurrentTasks\] = useState\(1\)/, "ImageStudio should default frontend concurrency to 1")
assert.match(source, /const taskAbortControllersRef = useRef\(new Map<string, AbortController>\(\)\)/, "running task controllers should be keyed by task id")
assert.match(source, /const taskTimeoutsRef = useRef\(new Map<string, number>\(\)\)/, "running task timeouts should be keyed by task id")
assert.doesNotMatch(source, /const \[result, setResult\] = useState<StudioResponse \| null>/, "selected task should replace singleton result state")
assert.doesNotMatch(source, /disabled=\{isGenerating\}/, "submitting a new task should remain available while other tasks run")
```

- [ ] **Step 2: Update obsolete source tests to task-oriented expectations**

Modify `tests/image-studio-stop-timeout-controls.test.ts` so it asserts these source patterns:

```ts
assert.match(source, /const \[requestTimeoutSeconds, setRequestTimeoutSeconds\] = useState\(/)
assert.match(source, /taskAbortControllersRef\.current\.set\(taskId, taskController\)/)
assert.match(source, /taskTimeoutsRef\.current\.set\(taskId, timeoutId\)/)
assert.match(source, /runImageStudioSession(?:<[^>]+>)?\(\{[\s\S]*signal:\s*taskController\.signal,[\s\S]*timeoutMs:\s*task\.snapshot\.timeoutMs,[\s\S]*\}\)/)
assert.match(source, /function stopTask\(taskId: string\)/)
```

Modify `tests/image-studio-history-window.test.ts` so it keeps the `appendImageStudioHistory()` helper assertions and changes the component source assertion to:

```ts
assert.match(source, /appendImageStudioHistory\(current, historyResult, IMAGE_STUDIO_HISTORY_LIMIT\)/)
assert.match(source, /selectedTask\.images\.map\(\(image, index\) => \{/)
```

Modify `tests/image-studio-history-keys.test.ts` so it asserts:

```ts
assert.match(source, /type StudioResponse = ImageTaskHistoryResult<StudioDebug>/)
assert.match(source, /createHistoryResultFromTask<StudioDebug>\(terminalTask\)/)
assert.doesNotMatch(source, /apiKey:[\s\S]*history/)
```

- [ ] **Step 3: Run the source tests and verify they fail**

Run: `pnpm exec tsx tests/image-studio-task-source.test.ts && pnpm exec tsx tests/image-studio-stop-timeout-controls.test.ts && pnpm exec tsx tests/image-studio-history-window.test.ts && pnpm exec tsx tests/image-studio-history-keys.test.ts`

Expected: at least the new task-source assertions fail because `ImageStudio` still uses singleton generation state.

- [ ] **Step 4: Introduce task state and refs in `ImageStudio`**

Modify imports in `src/components/image-studio.tsx`:

```ts
import {
  clampMaxConcurrentTasks,
  createHistoryResultFromTask,
  createImageTaskSnapshot,
  createQueuedImageTask,
  getNextRunnableTaskIds,
  isTerminalTaskStatus,
  sanitizeImageTaskSnapshot,
  updateTaskImages,
  type ImageTask,
  type ImageTaskHistoryResult,
  type ImageTaskStatus,
} from "@/lib/image-studio-tasks"
```

Replace the local `StudioResponse` definition with:

```ts
type StudioResponse = ImageTaskHistoryResult<StudioDebug>
```

Add state and refs near the existing form state:

```ts
const taskAbortControllersRef = useRef(new Map<string, AbortController>())
const taskTimeoutsRef = useRef(new Map<string, number>())
const runningTaskIdsRef = useRef(new Set<string>())
const tasksRef = useRef<ImageTask<StudioDebug>[]>([])
const [tasks, setTasks] = useState<ImageTask<StudioDebug>[]>([])
const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(1)
const [elapsedNow, setElapsedNow] = useState(() => Date.now())
```

Remove singleton state that cannot represent multiple tasks: `isGenerating`, `progress`, `generationStartedAt`, `elapsedGenerationSeconds`, `result`, and global `selectedImageIndex`. Keep `history` and make selected-image index live inside each task.

Add derived state:

```ts
const selectedTask = tasks.find((task) => task.snapshot.id === selectedTaskId) || tasks.at(-1) || null
const selectedTaskImage = selectedTask?.images[selectedTask.selectedImageIndex] || selectedTask?.images[0] || null
const selectedTaskImageNumber = selectedTaskImage ? Math.min(selectedTask.selectedImageIndex, Math.max(selectedTask.images.length - 1, 0)) + 1 : 0
const isAnyTaskRunning = tasks.some((task) => task.status === "running")
```

- [ ] **Step 5: Add task ref synchronization and unmount cleanup**

Add effects:

```ts
useEffect(() => {
  tasksRef.current = tasks
}, [tasks])

useEffect(() => {
  if (!isAnyTaskRunning) return
  const intervalId = window.setInterval(() => setElapsedNow(Date.now()), 1000)
  return () => window.clearInterval(intervalId)
}, [isAnyTaskRunning])
```

Replace singleton unmount abort/timeout cleanup with map cleanup:

```ts
for (const timeoutId of taskTimeoutsRef.current.values()) {
  window.clearTimeout(timeoutId)
}
taskTimeoutsRef.current.clear()

for (const controller of taskAbortControllersRef.current.values()) {
  controller.abort(createGenerationControlError("GenerationAbortError", "component-unmounted"))
}
taskAbortControllersRef.current.clear()
runningTaskIdsRef.current.clear()
```

- [ ] **Step 6: Run the task-state source tests**

Run: `pnpm exec tsx tests/image-studio-task-source.test.ts && pnpm exec tsx tests/image-studio-stop-timeout-controls.test.ts && pnpm exec tsx tests/image-studio-history-window.test.ts && pnpm exec tsx tests/image-studio-history-keys.test.ts`

Expected: tests pass after state names and source contracts are in place, even if later UI behavior is not complete yet.

- [ ] **Step 7: Authorized checkpoint commit**

Run only if commit authorization is active: `git add src/components/image-studio.tsx tests/image-studio-task-source.test.ts tests/image-studio-stop-timeout-controls.test.ts tests/image-studio-history-window.test.ts tests/image-studio-history-keys.test.ts && git commit -m "feat: add image studio task state contract"`

Expected: one commit is created. If commit authorization is absent, do not commit.

---

### Task 4: Snapshot Submission And Per-Task Session Execution

**Files:**
- Modify: `src/components/image-studio.tsx`
- Create: `tests/image-studio-task-session-source.test.ts`
- Modify: `tests/image-studio-missing-api-key-dialog.test.ts`
- Modify: `tests/image-studio-remember-key-dialog.test.ts`

- [ ] **Step 1: Write the failing session-source test**

Create `tests/image-studio-task-session-source.test.ts`:

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(source, /function enqueueGenerationTask\(/, "submission should enqueue a task snapshot")
assert.match(source, /createImageTaskSnapshot\(\{[\s\S]*requestPrompt: buildRequestPrompt\(prompt, activeSource\),[\s\S]*apiKey: effectiveApiKey,[\s\S]*references: inputUploads\.map\(\(upload\) => upload\.file\)/, "snapshot should capture prompt, derived prompt, key, and file references at submit time")
assert.match(source, /function startTask\(taskId: string\)/, "scheduler should start individual tasks by id")
assert.match(source, /getNextRunnableTaskIds\(tasks, maxConcurrentTasks\)/, "scheduler should use the pure concurrency helper")
assert.match(source, /runImageStudioSession<StudioDebug>\(\{[\s\S]*apiKey:\s*task\.snapshot\.apiKey,[\s\S]*endpoint:\s*task\.snapshot\.endpoint,[\s\S]*imageCount:\s*task\.snapshot\.imageCount,[\s\S]*images:\s*task\.snapshot\.references,[\s\S]*locale:\s*task\.snapshot\.locale,[\s\S]*model:\s*task\.snapshot\.model,[\s\S]*prompt:\s*task\.snapshot\.requestPrompt,[\s\S]*timeoutMs:\s*task\.snapshot\.timeoutMs/, "running tasks should call the existing session helper with snapshot values")
assert.doesNotMatch(source, /setResult\(/, "task execution should not restore singleton result state")
```

- [ ] **Step 2: Run the source test and verify it fails**

Run: `pnpm exec tsx tests/image-studio-task-session-source.test.ts`

Expected: failure because enqueue/start task functions do not exist yet or still use live form state in `runImageStudioSession()`.

- [ ] **Step 3: Replace singleton `startGeneration()` with snapshot enqueue**

In `src/components/image-studio.tsx`, keep existing validation and dialog gating, but rename the actual creation path to `enqueueGenerationTask()`:

```ts
async function enqueueGenerationTask(requestApiKey?: string, options?: { skipRememberPrompt?: boolean }) {
  if (progressResetTimeoutRef.current) {
    window.clearTimeout(progressResetTimeoutRef.current)
    progressResetTimeoutRef.current = null
  }

  if (!prompt.trim()) {
    toast.error(text.promptRequired)
    return
  }

  if (isCustomSize && !customSizeValue) {
    toast.error(text.customAspectInvalid)
    return
  }

  const effectiveApiKey = (requestApiKey ?? apiKey).trim()
  if (!effectiveApiKey) {
    setMissingApiKeyValue("")
    setMissingApiKeyRemember(rememberKey)
    setPendingGenerationAfterApiKey(true)
    setIsMissingApiKeyDialogOpen(true)
    return
  }

  if (!options?.skipRememberPrompt) {
    setPendingGenerationAfterRemember(true)
    if (promptToRememberApiKey()) return
    setPendingGenerationAfterRemember(false)
  }

  const total = Math.min(Math.max(imageCount, 1), 4)
  const taskId = createClientId()
  const snapshot = createImageTaskSnapshot({
    apiKey: effectiveApiKey,
    background,
    endpoint: endpoint.trim(),
    generation: activeSource ? activeSource.round + 1 : 1,
    id: taskId,
    imageCount: total,
    locale,
    model,
    outputFormat,
    prompt,
    quality,
    references: inputUploads.map((upload) => upload.file),
    requestPrompt: buildRequestPrompt(prompt, activeSource),
    size,
    sourceLabel: activeSource?.label,
    submittedAt: Date.now(),
    timeoutMs: requestTimeoutMs,
  })

  setTasks((current) => [...current, createQueuedImageTask<StudioDebug>(snapshot)])
  setSelectedTaskId(taskId)
}
```

Update remember/missing-key continuations and `handleSubmit()` to call `enqueueGenerationTask()` instead of `startGeneration()`.

- [ ] **Step 4: Add scheduler effect and `startTask(taskId)`**

Add a scheduler effect:

```ts
useEffect(() => {
  const runnableTaskIds = getNextRunnableTaskIds(tasks, maxConcurrentTasks)
  for (const taskId of runnableTaskIds) {
    startTask(taskId)
  }
}, [tasks, maxConcurrentTasks])
```

Implement `startTask(taskId: string)` so it returns immediately when `runningTaskIdsRef.current.has(taskId)`, finds the queued task from `tasksRef.current`, creates a new `AbortController`, stores controller and timeout by id, marks only that task running, and invokes `runTask(task, taskController)`.

Required start transition sketch:

```ts
function startTask(taskId: string) {
  if (runningTaskIdsRef.current.has(taskId)) return
  const task = tasksRef.current.find((item) => item.snapshot.id === taskId && item.status === "queued")
  if (!task) return

  const taskController = new AbortController()
  runningTaskIdsRef.current.add(taskId)
  taskAbortControllersRef.current.set(taskId, taskController)

  const timeoutId = window.setTimeout(() => {
    taskController.abort(createGenerationControlError("GenerationTimeoutError", t(task.snapshot.locale, "generationTimedOut", { seconds: Math.ceil(task.snapshot.timeoutMs / 1000) })))
  }, task.snapshot.timeoutMs)
  taskTimeoutsRef.current.set(taskId, timeoutId)

  setTasks((current) => current.map((item) => item.snapshot.id === taskId
    ? { ...item, status: "running", progress: 8, startedAt: Date.now() }
    : item
  ))

  void runTask(task, taskController)
}
```

- [ ] **Step 5: Add `runTask()` around the existing session helper**

Implement `runTask(task, taskController)` with snapshot-only values:

```ts
async function runTask(task: ImageTask<StudioDebug>, taskController: AbortController) {
  const taskId = task.snapshot.id
  let completedCount = 0

  try {
    const sessionResult = await runImageStudioSession<StudioDebug>({
      apiKey: task.snapshot.apiKey,
      background: task.snapshot.background,
      endpoint: task.snapshot.endpoint,
      imageCount: task.snapshot.imageCount,
      images: task.snapshot.references,
      isControlError: (error) => isGenerationControlError(error, "GenerationAbortError") || isGenerationControlError(error, "GenerationTimeoutError"),
      locale: task.snapshot.locale,
      model: task.snapshot.model,
      onImagesUpdated: (images) => {
        completedCount = images.length
        setTasks((current) => current.map((item) => item.snapshot.id === taskId
          ? { ...updateTaskImages(item, images), progress: Math.min(95, 8 + Math.round((images.length / item.snapshot.imageCount) * 87)) }
          : item
        ))
      },
      onProxyResult: (proxyResult) => {
        setTasks((current) => current.map((item) => item.snapshot.id === taskId
          ? {
              ...item,
              debug: proxyResult.debug || item.debug,
              endpoint: proxyResult.endpoint,
              quality: proxyResult.quality || item.quality,
              qualityReported: proxyResult.qualityReported,
              size: proxyResult.size || item.size,
              sizeReported: proxyResult.sizeReported,
            }
          : item
        ))
      },
      outputFormat: task.snapshot.outputFormat,
      prompt: task.snapshot.requestPrompt,
      quality: task.snapshot.quality,
      signal: taskController.signal,
      size: task.snapshot.size,
      timeoutMs: task.snapshot.timeoutMs,
    })

    completeTaskFromSessionResult(taskId, sessionResult)
  } catch (error) {
    completeTaskFromError(taskId, error, completedCount)
  } finally {
    clearTaskRuntime(taskId)
  }
}
```

Add `clearTaskRuntime(taskId)` to clear only that id's timeout, controller, and running marker.

- [ ] **Step 6: Run session source and existing dialog tests**

Run: `pnpm exec tsx tests/image-studio-task-session-source.test.ts && pnpm exec tsx tests/image-studio-missing-api-key-dialog.test.ts && pnpm exec tsx tests/image-studio-remember-key-dialog.test.ts`

Expected: source test passes and existing dialog source tests still pass after call sites use `enqueueGenerationTask()`.

- [ ] **Step 7: Authorized checkpoint commit**

Run only if commit authorization is active: `git add src/components/image-studio.tsx tests/image-studio-task-session-source.test.ts tests/image-studio-missing-api-key-dialog.test.ts tests/image-studio-remember-key-dialog.test.ts && git commit -m "feat: enqueue image generation tasks"`

Expected: one commit is created. If commit authorization is absent, do not commit.

---

### Task 5: Terminal State, Inline Result Data, And History

**Files:**
- Modify: `src/components/image-studio.tsx`
- Modify: `tests/image-studio-history-window.test.ts`
- Modify: `tests/image-studio-history-keys.test.ts`
- Create: `tests/image-studio-task-terminal-source.test.ts`

- [ ] **Step 1: Write the failing terminal-state source test**

Create `tests/image-studio-task-terminal-source.test.ts`:

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(source, /function completeTaskFromSessionResult\(/, "successful and partial sessions should use a terminal transition helper")
assert.match(source, /status:\s*sessionResult\.isPartial \? "partial" : "completed"/, "session partial flag should become task status")
assert.match(source, /partialErrorMessage:\s*sessionResult\.isPartial/, "partial tasks should keep inline-readable error state")
assert.match(source, /function completeTaskFromError\(/, "errors should use a terminal transition helper")
assert.match(source, /isGenerationControlError\(error, "GenerationAbortError"\)[\s\S]*status:\s*"stopped"/, "abort control errors should become stopped tasks")
assert.match(source, /isGenerationControlError\(error, "GenerationTimeoutError"\)[\s\S]*status:\s*"timedOut"/, "timeout control errors should become timedOut tasks")
assert.match(source, /sanitizeImageTaskSnapshot\(item\.snapshot\)/, "terminal transitions should sanitize API keys from task snapshots")
assert.match(source, /createHistoryResultFromTask<StudioDebug>\(terminalTask\)/, "completed and partial tasks should feed sanitized history")
```

- [ ] **Step 2: Run the terminal source test and verify it fails**

Run: `pnpm exec tsx tests/image-studio-task-terminal-source.test.ts`

Expected: failure until terminal transition helpers exist.

- [ ] **Step 3: Implement terminal transition helpers**

Add `completeTaskFromSessionResult(taskId, sessionResult)`:

```ts
function completeTaskFromSessionResult(taskId: string, sessionResult: ImageStudioSessionResult<StudioDebug>) {
  setTasks((current) => current.map((item) => {
    if (item.snapshot.id !== taskId) return item
    if (!sessionResult.images.length) {
      return {
        ...item,
        completedAt: Date.now(),
        errorMessage: getGenerationErrorMessage(sessionResult.firstError, text.allRequestsFailed),
        progress: 0,
        snapshot: sanitizeImageTaskSnapshot(item.snapshot),
        status: "failed",
      }
    }

    const terminalTask: ImageTask<StudioDebug> = {
      ...updateTaskImages(item, sessionResult.images.slice(0, item.snapshot.imageCount)),
      completedAt: Date.now(),
      debug: sessionResult.debug || item.debug,
      endpoint: sessionResult.endpoint,
      partialErrorMessage: sessionResult.isPartial
        ? getGenerationErrorMessage(sessionResult.firstError, text.generationFailed)
        : null,
      progress: 100,
      quality: sessionResult.quality,
      qualityReported: sessionResult.qualityReported,
      size: sessionResult.size,
      sizeReported: sessionResult.sizeReported,
      snapshot: sanitizeImageTaskSnapshot(item.snapshot),
      status: sessionResult.isPartial ? "partial" : "completed",
    }

    const historyResult = createHistoryResultFromTask<StudioDebug>(terminalTask)
    if (historyResult) {
      setHistory((history) => appendImageStudioHistory(history, historyResult, IMAGE_STUDIO_HISTORY_LIMIT))
    }

    return terminalTask
  }))
}
```

Add `completeTaskFromError(taskId, error, completedCount)` with this concrete transition logic. It preserves images already published through `onImagesUpdated`, records the user-visible message in `errorMessage`, sanitizes the snapshot, and does not write stopped or timed-out tasks to history.

```ts
function completeTaskFromError(taskId: string, error: unknown, completedCount: number) {
  const isAbort = isGenerationControlError(error, "GenerationAbortError")
  const isTimeout = isGenerationControlError(error, "GenerationTimeoutError")

  setTasks((current) => current.map((item) => {
    if (item.snapshot.id !== taskId) return item

    const terminalStatus: ImageTaskStatus = isAbort ? "stopped" : isTimeout ? "timedOut" : "failed"
    const fallbackMessage = isAbort
      ? text.generationStopped
      : isTimeout
        ? t(item.snapshot.locale, "generationTimedOut", { seconds: Math.ceil(item.snapshot.timeoutMs / 1000) })
        : text.generationFailed
    const errorMessage = getGenerationErrorMessage(error, fallbackMessage)
    const keptImages = item.images.slice(0, Math.max(completedCount, item.images.length))

    return {
      ...updateTaskImages(item, keptImages),
      completedAt: Date.now(),
      errorMessage,
      partialErrorMessage: null,
      progress: terminalStatus === "failed" ? 0 : item.progress,
      snapshot: sanitizeImageTaskSnapshot(item.snapshot),
      status: terminalStatus,
    }
  }))
}
```

If the ordinary error path later needs partial-success history, it must go through `completeTaskFromSessionResult()` with `sessionResult.isPartial`; this error helper is for abort, timeout, and zero-result failure only.

- [ ] **Step 4: Render selected task data instead of singleton result data**

Replace every result-grid, summary, debug, and empty/skeleton branch that reads `result` with `selectedTask`:

```ts
const selectedTaskHasImages = Boolean(selectedTask?.images.length)
const selectedQueuePosition = selectedTask?.status === "queued"
  ? tasks.filter((task) => task.status === "queued").findIndex((task) => task.snapshot.id === selectedTask.snapshot.id) + 1
  : 0
const selectedPendingCount = selectedTask
  ? Math.max(selectedTask.snapshot.imageCount - selectedTask.images.length, 0)
  : 0
```

Use this selected-result branch in the result area, preserving the existing `GeneratedImageCard` props and card classes from the singleton `result` grid:

```tsx
{!selectedTask && (
  <EmptyResultState title={text.emptyTitle} description={text.emptyDescription} />
)}

{selectedTask?.status === "queued" && (
  <EmptyResultState
    title={text.taskStatusQueued}
    description={`${text.taskQueueTitle} #${selectedQueuePosition}: ${selectedTask.snapshot.prompt}`}
  />
)}

{selectedTask?.status === "running" && !selectedTaskHasImages && (
  <GenerationSkeleton count={selectedTask.snapshot.imageCount} />
)}

{selectedTask && ["partial", "failed", "stopped", "timedOut"].includes(selectedTask.status) && (
  <TaskStatusCallout locale={locale} task={selectedTask} text={text} />
)}

{selectedTaskHasImages && (
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {selectedTask.images.map((image, index) => (
      <GeneratedImageCard
        key={`${selectedTask.snapshot.id}-${index}`}
        image={image}
        imageNumber={index + 1}
        isSelected={selectedTask.selectedImageIndex === index}
        onSelect={() => updateTaskSelectedImageIndex(selectedTask.snapshot.id, index)}
        onUseAsSource={() => setGeneratedImageAsSource(index)}
      />
    ))}
    {selectedTask.status === "running" && Array.from({ length: selectedPendingCount }, (_, index) => (
      <PendingImageCard key={`pending-${selectedTask.snapshot.id}-${index}`} />
    ))}
  </div>
)}

{selectedTask?.status === "failed" && !selectedTaskHasImages && (
  <EmptyResultState title={text.taskStatusFailed} description={selectedTask.errorMessage || text.generationFailed} />
)}

{selectedTask?.status === "stopped" && !selectedTaskHasImages && (
  <EmptyResultState title={text.taskStatusStopped} description={t(locale, "taskStoppedInline", { count: 0, suffix: pluralSuffix(locale, 0) })} />
)}

{selectedTask?.status === "timedOut" && !selectedTaskHasImages && (
  <EmptyResultState title={text.taskStatusTimedOut} description={t(locale, "taskTimedOutInline", { count: 0, suffix: pluralSuffix(locale, 0) })} />
)}
```

Render completed tasks through the same `selectedTaskHasImages` image grid. Render partial, stopped, and timed-out tasks through the image grid when images exist plus `TaskStatusCallout` above the grid. Render failed tasks with `TaskStatusCallout` and no cards unless `item.images` already contains preserved images.

Keep the existing image card layout and summary card visual style. Change summary values to selected-task snapshot/result values:

```ts
[text.summaryModel, selectedTask.snapshot.model]
[text.summaryCount, selectedTask.images.length === selectedTask.snapshot.imageCount ? String(selectedTask.images.length) : `${selectedTask.images.length} / ${selectedTask.snapshot.imageCount}`]
[text.summaryRefs, String(selectedTask.snapshot.references.length)]
[text.summaryEndpoint, selectedTask.endpoint || selectedTask.snapshot.endpoint]
```

- [ ] **Step 5: Run terminal/history tests**

Run: `pnpm exec tsx tests/image-studio-task-terminal-source.test.ts && pnpm exec tsx tests/image-studio-history-window.test.ts && pnpm exec tsx tests/image-studio-history-keys.test.ts && pnpm exec tsx tests/image-studio-tasks.test.ts`

Expected: all commands pass.

- [ ] **Step 6: Authorized checkpoint commit**

Run only if commit authorization is active: `git add src/components/image-studio.tsx tests/image-studio-task-terminal-source.test.ts tests/image-studio-history-window.test.ts tests/image-studio-history-keys.test.ts && git commit -m "feat: complete image tasks with sanitized history"`

Expected: one commit is created. If commit authorization is absent, do not commit.

---

### Task 6: Concurrency Control, Task List UI, And Localized Copy

**Files:**
- Modify: `src/components/image-studio.tsx`
- Modify: `src/lib/i18n.ts`
- Create: `tests/image-studio-task-copy.test.ts`

- [ ] **Step 1: Write the failing copy/source test**

Create `tests/image-studio-task-copy.test.ts`:

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { studioMessages, type Locale } from "../src/lib/i18n"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")
const locales = Object.keys(studioMessages) as Locale[]
const requiredKeys = [
  "maxConcurrentTasks",
  "maxConcurrentTasksDescription",
  "taskQueueTitle",
  "taskQueueEmpty",
  "taskStatusQueued",
  "taskStatusRunning",
  "taskStatusCompleted",
  "taskStatusPartial",
  "taskStatusFailed",
  "taskStatusStopped",
  "taskStatusTimedOut",
  "removeQueuedTask",
  "taskPartialInline",
  "taskFailedInline",
  "taskStoppedInline",
  "taskTimedOutInline",
] as const

for (const locale of locales) {
  for (const key of requiredKeys) {
    assert.equal(typeof studioMessages[locale][key], "string", `${locale}.${key} should exist`)
    assert.ok(studioMessages[locale][key].trim(), `${locale}.${key} should not be blank`)
  }
}

assert.match(source, /id="max-concurrent-tasks"/, "UI should expose a max concurrent tasks control")
assert.match(source, /setMaxConcurrentTasks\(clampMaxConcurrentTasks\(Number\(value\)\)\)/, "concurrency control should clamp values through the helper")
assert.match(source, /function TaskQueueList\(/, "task queue/list should be a named component in the result area")
assert.match(source, /status === "running"[\s\S]*text\.stopGeneration/, "running task rows should expose stop copy")
assert.match(source, /status === "queued"[\s\S]*text\.removeQueuedTask/, "queued task rows should expose remove copy")
const taskQueueSource = source.match(/function TaskQueueList\([\s\S]*?\n}\n\nfunction/)?.[0] || ""
assert.ok(taskQueueSource, "TaskQueueList source should be present")
assert.doesNotMatch(taskQueueSource, /snapshot\.apiKey/, "task UI should not render raw snapshot API keys")
```

- [ ] **Step 2: Run the copy/source test and verify it fails**

Run: `pnpm exec tsx tests/image-studio-task-copy.test.ts`

Expected: failure because task UI copy and `TaskQueueList` do not exist yet.

- [ ] **Step 3: Add required i18n copy**

Add the keys from the test to `en`, `zh`, `zh-TW`, and `ja` using these exact values. For `ko`, `es`, `fr`, `de`, and `pt`, retain the file's existing `...en` inheritance and override only if adjacent copy is already localized in that block.

English (`en`):

```ts
maxConcurrentTasks: "max concurrent tasks",
maxConcurrentTasksDescription: "Starts up to {count} browser task(s) at once. The API or provider may still rate-limit requests.",
taskQueueTitle: "Task queue",
taskQueueEmpty: "Submitted tasks will appear here while queued, running, and completed.",
taskStatusQueued: "queued",
taskStatusRunning: "running",
taskStatusCompleted: "completed",
taskStatusPartial: "partial",
taskStatusFailed: "failed",
taskStatusStopped: "stopped",
taskStatusTimedOut: "timed out",
removeQueuedTask: "Remove",
taskPartialInline: "Generated {count}/{total}. Partial result kept: {error}",
taskFailedInline: "This task failed: {error}",
taskStoppedInline: "This task was stopped. Kept {count} image{suffix}.",
taskTimedOutInline: "This task timed out. Kept {count} image{suffix}.",
```

Simplified Chinese (`zh`):

```ts
maxConcurrentTasks: "最大并发任务数",
maxConcurrentTasksDescription: "一次最多启动 {count} 个浏览器任务。API 或服务提供商仍可能限制请求速率。",
taskQueueTitle: "任务队列",
taskQueueEmpty: "提交的任务会在排队、运行和完成时显示在这里。",
taskStatusQueued: "排队中",
taskStatusRunning: "运行中",
taskStatusCompleted: "已完成",
taskStatusPartial: "部分完成",
taskStatusFailed: "失败",
taskStatusStopped: "已停止",
taskStatusTimedOut: "已超时",
removeQueuedTask: "移除",
taskPartialInline: "已生成 {count}/{total}。已保留部分结果：{error}",
taskFailedInline: "此任务失败：{error}",
taskStoppedInline: "此任务已停止。已保留 {count} 张图片。",
taskTimedOutInline: "此任务已超时。已保留 {count} 张图片。",
```

Traditional Chinese (`zh-TW`):

```ts
maxConcurrentTasks: "最大並行任務數",
maxConcurrentTasksDescription: "一次最多啟動 {count} 個瀏覽器任務。API 或服務供應商仍可能限制請求速率。",
taskQueueTitle: "任務佇列",
taskQueueEmpty: "提交的任務會在排隊、執行和完成時顯示在這裡。",
taskStatusQueued: "排隊中",
taskStatusRunning: "執行中",
taskStatusCompleted: "已完成",
taskStatusPartial: "部分完成",
taskStatusFailed: "失敗",
taskStatusStopped: "已停止",
taskStatusTimedOut: "已逾時",
removeQueuedTask: "移除",
taskPartialInline: "已生成 {count}/{total}。已保留部分結果：{error}",
taskFailedInline: "此任務失敗：{error}",
taskStoppedInline: "此任務已停止。已保留 {count} 張圖片。",
taskTimedOutInline: "此任務已逾時。已保留 {count} 張圖片。",
```

Japanese (`ja`):

```ts
maxConcurrentTasks: "最大同時実行タスク数",
maxConcurrentTasksDescription: "一度に最大 {count} 件のブラウザータスクを開始します。API またはプロバイダー側でリクエストが制限される場合があります。",
taskQueueTitle: "タスクキュー",
taskQueueEmpty: "送信したタスクは、待機中、実行中、完了後にここへ表示されます。",
taskStatusQueued: "待機中",
taskStatusRunning: "実行中",
taskStatusCompleted: "完了",
taskStatusPartial: "一部完了",
taskStatusFailed: "失敗",
taskStatusStopped: "停止済み",
taskStatusTimedOut: "タイムアウト",
removeQueuedTask: "削除",
taskPartialInline: "{count}/{total} 件を生成しました。部分結果を保持しました: {error}",
taskFailedInline: "このタスクは失敗しました: {error}",
taskStoppedInline: "このタスクは停止されました。{count} 件の画像を保持しました。",
taskTimedOutInline: "このタスクはタイムアウトしました。{count} 件の画像を保持しました。",
```

- [ ] **Step 4: Add max concurrent tasks control near output/timeout controls**

In the left panel, add a field near image count or request timeout:

```tsx
<Field>
  <div className="flex items-center justify-between">
    <FieldLabel htmlFor="max-concurrent-tasks" className="text-xs font-semibold text-muted-foreground">
      {text.maxConcurrentTasks}
    </FieldLabel>
    <span className="font-mono text-xs text-foreground">×{maxConcurrentTasks}</span>
  </div>
  <Select
    items={[1, 2, 3, 4].map((value) => ({ label: String(value), value: String(value) }))}
    value={String(maxConcurrentTasks)}
    onValueChange={(value) => setMaxConcurrentTasks(clampMaxConcurrentTasks(Number(value)))}
  >
    <SelectTrigger id="max-concurrent-tasks" className="studio-control h-11 w-full rounded-md font-mono text-xs">
      <SelectValue />
    </SelectTrigger>
    <SelectContent><SelectGroup>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>
  <FieldDescription className="text-xs">
    {t(locale, "maxConcurrentTasksDescription", { count: maxConcurrentTasks })}
  </FieldDescription>
</Field>
```

- [ ] **Step 5: Add task queue/list UI above the result grid**

Add `TaskQueueList` below `ImageStudio` or near other local components:

```tsx
function getTaskStatusLabel(text: StudioMessages, status: ImageTaskStatus) {
  const labels: Record<ImageTaskStatus, string> = {
    completed: text.taskStatusCompleted,
    failed: text.taskStatusFailed,
    partial: text.taskStatusPartial,
    queued: text.taskStatusQueued,
    running: text.taskStatusRunning,
    stopped: text.taskStatusStopped,
    timedOut: text.taskStatusTimedOut,
  }

  return labels[status]
}

function formatTaskEndpoint(value: string) {
  try {
    const url = new URL(value)
    return url.host
  } catch {
    return value.length > 36 ? `${value.slice(0, 34)}...` : value
  }
}

function TaskQueueList({
  elapsedNow,
  selectedTaskId,
  tasks,
  text,
  onRemoveQueuedTask,
  onSelectTask,
  onStopTask,
}: {
  elapsedNow: number
  selectedTaskId: string | null
  tasks: ImageTask<StudioDebug>[]
  text: StudioMessages
  onRemoveQueuedTask: (taskId: string) => void
  onSelectTask: (taskId: string) => void
  onStopTask: (taskId: string) => void
}) {
  if (!tasks.length) {
    return <p className="text-xs text-muted-foreground">{text.taskQueueEmpty}</p>
  }

  return (
    <section aria-label={text.taskQueueTitle} className="mb-5 flex flex-col gap-2">
      {tasks.map((task) => {
        const status = task.status
        const isSelected = task.snapshot.id === selectedTaskId
        const elapsedSeconds = task.startedAt ? Math.max(0, Math.floor((elapsedNow - task.startedAt) / 1000)) : 0
        const generatedLabel = `${task.images.length} / ${task.snapshot.imageCount}`

        return (
          <article
            key={task.snapshot.id}
            data-task-id={task.snapshot.id}
            data-task-status={status}
            className={cn("rounded-lg border bg-muted/25 p-3", isSelected && "border-primary bg-primary/5")}
          >
            <button type="button" className="w-full text-left" onClick={() => onSelectTask(task.snapshot.id)}>
              <div className="flex items-center justify-between gap-3">
                <span className="line-clamp-1 text-sm font-medium text-foreground">{task.snapshot.prompt}</span>
                <Badge variant={status === "running" ? "default" : "secondary"} className="rounded-md">
                  {getTaskStatusLabel(text, status)}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span>{generatedLabel}</span>
                <span>{task.snapshot.model}</span>
                <span>{task.snapshot.size}</span>
                <span>{task.snapshot.outputFormat.toUpperCase()}</span>
                <span>{task.snapshot.references.length} refs</span>
                <span>{formatTaskEndpoint(task.endpoint || task.snapshot.endpoint)}</span>
                <span>{task.snapshot.apiKeySet ? text.keySet : text.noKey}</span>
                {status === "running" && <span>{elapsedSeconds}s</span>}
              </div>
              {status === "running" && <Progress value={task.progress} className="mt-3 h-1.5" />}
            </button>
            <div className="mt-3 flex justify-end gap-2">
              {status === "running" && (
                <Button type="button" size="sm" variant="outline" onClick={() => onStopTask(task.snapshot.id)}>
                  {text.stopGeneration}
                </Button>
              )}
              {status === "queued" && (
                <Button type="button" size="sm" variant="outline" onClick={() => onRemoveQueuedTask(task.snapshot.id)}>
                  {text.removeQueuedTask}
                </Button>
              )}
            </div>
          </article>
        )
      })}
    </section>
  )
}
```

Each row must display `task.snapshot.prompt`, status badge, progress or generated count, `task.snapshot.model`, `task.snapshot.size`, `task.snapshot.outputFormat`, `task.snapshot.imageCount`, `task.snapshot.references.length`, endpoint host/truncated endpoint, and `task.snapshot.apiKeySet ? text.keySet : text.noKey`. It must not render `task.snapshot.apiKey`.

- [ ] **Step 6: Wire row actions**

Add `stopTask(taskId)` and `removeQueuedTask(taskId)` handlers:

```ts
function stopTask(taskId: string) {
  taskAbortControllersRef.current.get(taskId)?.abort(
    createGenerationControlError("GenerationAbortError", text.generationStopped)
  )
}

function removeQueuedTask(taskId: string) {
  setTasks((current) => current.filter((task) => task.snapshot.id !== taskId || task.status !== "queued"))
  setSelectedTaskId((current) => current === taskId ? tasksRef.current.find((task) => task.snapshot.id !== taskId)?.snapshot.id || null : current)
}
```

Render `Stop` only when `task.status === "running"` and `Remove` only when `task.status === "queued"`.

- [ ] **Step 7: Run copy/source test**

Run: `pnpm exec tsx tests/image-studio-task-copy.test.ts`

Expected: command exits successfully.

- [ ] **Step 8: Authorized checkpoint commit**

Run only if commit authorization is active: `git add src/components/image-studio.tsx src/lib/i18n.ts tests/image-studio-task-copy.test.ts && git commit -m "feat: add image task queue UI"`

Expected: one commit is created. If commit authorization is absent, do not commit.

---

### Task 7: Per-Task Stop, Remove, Timeout, And Partial Inline Behavior

**Files:**
- Modify: `src/components/image-studio.tsx`
- Create: `tests/image-studio-task-lifecycle-source.test.ts`
- Modify: `tests/browser/image-studio-smoke.spec.ts`

- [ ] **Step 1: Write the failing lifecycle source test**

Create `tests/image-studio-task-lifecycle-source.test.ts`:

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(source, /function clearTaskRuntime\(taskId: string\)/, "runtime cleanup should be per task")
assert.match(source, /taskTimeoutsRef\.current\.get\(taskId\)/, "cleanup should read timeout by task id")
assert.match(source, /taskAbortControllersRef\.current\.delete\(taskId\)/, "cleanup should delete only the completed task controller")
assert.match(source, /runningTaskIdsRef\.current\.delete\(taskId\)/, "cleanup should delete only the completed running marker")
assert.match(source, /function removeQueuedTask\(taskId: string\)/, "queued task removal should have a dedicated handler")
assert.match(source, /task\.snapshot\.id !== taskId \|\| task\.status !== "queued"/, "removeQueuedTask should keep running and terminal tasks")
assert.match(source, /task\.status === "partial"[\s\S]*text\.taskPartialInline/, "partial status should have inline selected-task copy")
assert.match(source, /task\.status === "failed"[\s\S]*text\.taskFailedInline/, "failed status should have inline selected-task copy")
assert.match(source, /task\.status === "stopped"[\s\S]*text\.taskStoppedInline/, "stopped status should have inline selected-task copy")
assert.match(source, /task\.status === "timedOut"[\s\S]*text\.taskTimedOutInline/, "timedOut status should have inline selected-task copy")
```

- [ ] **Step 2: Run the lifecycle source test and verify it fails**

Run: `pnpm exec tsx tests/image-studio-task-lifecycle-source.test.ts`

Expected: failure until per-task cleanup and inline callout source patterns exist.

- [ ] **Step 3: Implement per-task runtime cleanup**

Add this exact cleanup shape:

```ts
function clearTaskRuntime(taskId: string) {
  const timeoutId = taskTimeoutsRef.current.get(taskId)
  if (timeoutId) {
    window.clearTimeout(timeoutId)
  }

  taskTimeoutsRef.current.delete(taskId)
  taskAbortControllersRef.current.delete(taskId)
  runningTaskIdsRef.current.delete(taskId)
}
```

Ensure no code clears every timeout/controller when only one task finishes, stops, or times out.

- [ ] **Step 4: Implement inline task status callouts**

Add `TaskStatusCallout`:

```tsx
function TaskStatusCallout({ locale, task, text }: { locale: Locale; task: ImageTask<StudioDebug>; text: StudioMessages }) {
  const count = task.images.length
  const total = task.snapshot.imageCount
  const suffix = pluralSuffix(locale, count)

  if (task.status === "partial") {
    return <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{t(locale, "taskPartialInline", { count, total, error: task.partialErrorMessage || text.generationFailed })}</div>
  }

  if (task.status === "failed") {
    return <div role="status" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">{t(locale, "taskFailedInline", { error: task.errorMessage || text.generationFailed })}</div>
  }

  if (task.status === "stopped") {
    return <div role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{t(locale, "taskStoppedInline", { count, suffix })}</div>
  }

  if (task.status === "timedOut") {
    return <div role="status" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">{t(locale, "taskTimedOutInline", { count, suffix })}</div>
  }

  return null
}
```

Place the callout above the selected task grid so partial, failure, stopped, and timed-out states remain visible after toast dismissal.

- [ ] **Step 5: Ensure timeout starts only when queued task becomes running**

Confirm `window.setTimeout(() => taskController.abort(createGenerationControlError("GenerationTimeoutError", t(task.snapshot.locale, "generationTimedOut", { seconds: Math.ceil(task.snapshot.timeoutMs / 1000) }))), task.snapshot.timeoutMs)` exists only in `startTask(taskId)` after the task is selected by `getNextRunnableTaskIds()`. Do not create timeouts inside `enqueueGenerationTask()`.

Run: `pnpm exec tsx tests/image-studio-task-session-source.test.ts && pnpm exec tsx tests/image-studio-task-lifecycle-source.test.ts`

Expected: both commands pass and source test confirms task runtime refs are keyed by task id.

- [ ] **Step 6: Authorized checkpoint commit**

Run only if commit authorization is active: `git add src/components/image-studio.tsx tests/image-studio-task-lifecycle-source.test.ts && git commit -m "feat: isolate task stop timeout and partial states"`

Expected: one commit is created. If commit authorization is absent, do not commit.

---

### Task 8: Selected-Task Remix And Iteration Integration

**Files:**
- Modify: `src/components/image-studio.tsx`
- Create: `tests/image-studio-task-remix-source.test.ts`
- Modify: `tests/browser/image-studio-smoke.spec.ts`

- [ ] **Step 1: Write the failing remix source test**

Create `tests/image-studio-task-remix-source.test.ts`:

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(source, /const selectedTaskImage = selectedTask\?\.images\[selectedTask\.selectedImageIndex\] \|\| selectedTask\?\.images\[0\] \|\| null/, "selected image should come from selected task")
assert.match(source, /function updateTaskSelectedImageIndex\(taskId: string, imageIndex: number\)/, "image selection should update the selected task")
assert.match(source, /const image = selectedTask\?\.images\[index\]/, "setGeneratedImageAsSource should read selected task images")
assert.match(source, /round: selectedTask\?\.snapshot\.generation \|\| 1/, "active remix source should preserve selected task generation")
assert.match(source, /image=\{selectedTaskImage\}/, "RemixPanel should receive selected task image")
assert.match(source, /prompt=\{selectedTask\?\.snapshot\.prompt \|\| prompt\}/, "RemixPanel prompt should reflect selected task result when available")
```

- [ ] **Step 2: Run the remix source test and verify it fails**

Run: `pnpm exec tsx tests/image-studio-task-remix-source.test.ts`

Expected: failure until `setGeneratedImageAsSource()` and `RemixPanel` use selected task data.

- [ ] **Step 3: Move selected image index into task updates**

Add:

```ts
function updateTaskSelectedImageIndex(taskId: string, imageIndex: number) {
  setTasks((current) => current.map((task) => {
    if (task.snapshot.id !== taskId) return task
    const boundedIndex = Math.min(Math.max(imageIndex, 0), Math.max(task.images.length - 1, 0))
    return { ...task, selectedImageIndex: boundedIndex }
  }))
}
```

Change image card selection from `setSelectedImageIndex(index)` to:

```tsx
onClick={() => selectedTask && updateTaskSelectedImageIndex(selectedTask.snapshot.id, index)}
```

- [ ] **Step 4: Refactor `setGeneratedImageAsSource()` to read selected task**

Update the function:

```ts
async function setGeneratedImageAsSource(index: number, recipeId?: RemixRecipeId) {
  const image = selectedTask?.images[index]

  if (!image || !selectedTask) {
    toast.error(workflow.stageFailed)
    return
  }

  const upload = await createGeneratedUploadPreview({
    image,
    index,
    locale,
    outputFormat: selectedTask.snapshot.outputFormat,
  })

  const nextSource: ActiveSource = {
    label: `${workflow.sourceReady} · ${String(index + 1).padStart(2, "0")}`,
    promptSnapshot: image.revisedPrompt || selectedTask.snapshot.prompt || prompt.trim(),
    round: selectedTask?.snapshot.generation || 1,
    upload,
  }

  setActiveSource((current) => {
    if (current) {
      URL.revokeObjectURL(current.upload.url)
    }

    return nextSource
  })
  setUploads((current) => {
    const nextLimit = getReferenceUploadLimit(nextSource)
    const { overflow, visible } = splitUploadsByLimit(current, nextLimit)

    for (const extraUpload of overflow) {
      URL.revokeObjectURL(extraUpload.url)
    }

    if (overflow.length) {
      toast.warning(t(locale, "maxUploadsWarning", { count: nextLimit }))
    }

    return visible
  })
  updateTaskSelectedImageIndex(selectedTask.snapshot.id, index)

  if (recipeId) {
    const recipe = workflow.recipes[recipeId]
    const recipeItem = remixRecipeItems.find((item) => item.id === recipeId)

    updatePrompt((current) => appendRemixInstruction(current, recipe.instruction))
    setImageCount(recipeItem?.count || 1)
    toast.success(workflow.recipeSuccess)
    return
  }

  toast.success(workflow.referenceSuccess)
}
```

Do not mutate the selected task when staging a source image.

- [ ] **Step 5: Wire `RemixPanel` to selected task result**

Change props:

```tsx
<RemixPanel
  image={selectedTaskImage}
  imageIndex={selectedTaskImageNumber}
  isCjk={isCjk}
  outputFormat={selectedTask?.snapshot.outputFormat || outputFormat}
  prompt={selectedTask?.snapshot.prompt || prompt}
  size={selectedTask?.size || selectedTask?.snapshot.size || size}
  workflow={workflow}
  onCopyPrompt={copyPromptToClipboard}
  onSelectRecipe={(recipeId) => setGeneratedImageAsSource(selectedTaskImageNumber - 1, recipeId)}
  onStageReference={() => setGeneratedImageAsSource(selectedTaskImageNumber - 1)}
  onUseRevisedPrompt={(value) => updatePrompt(value)}
/>
```

- [ ] **Step 6: Run remix source test**

Run: `pnpm exec tsx tests/image-studio-task-remix-source.test.ts`

Expected: command exits successfully.

- [ ] **Step 7: Authorized checkpoint commit**

Run only if commit authorization is active: `git add src/components/image-studio.tsx tests/image-studio-task-remix-source.test.ts && git commit -m "feat: remix from selected image task"`

Expected: one commit is created. If commit authorization is absent, do not commit.

---

### Task 9: Browser Multi-Task Behavior Coverage

**Files:**
- Modify: `tests/browser/image-studio-smoke.spec.ts`
- Modify: `tests/browser/image-studio-test-helpers.ts`
- Modify: `src/components/image-studio.tsx`

- [ ] **Step 1: Add or update browser helpers for task rows**

Add these helpers to `tests/browser/image-studio-test-helpers.ts`:

```ts
export function taskRows(page: Page): Locator {
  return page.locator('main [data-task-status]')
}

export function taskRowByPrompt(page: Page, prompt: string): Locator {
  return taskRows(page).filter({ hasText: prompt }).first()
}
```

Expected: existing `selectedResultImage()` and `generatedResultImages()` continue to target the selected task result grid.

- [ ] **Step 2: Write the failing concurrent submission browser test**

Add to `tests/browser/image-studio-smoke.spec.ts`:

```ts
test("multi-task submissions use configured concurrency and immutable snapshots @cross-browser", async ({ page }) => {
  const intercepted: MultipartSnapshot[] = []
  const releases = [createDeferred<void>(), createDeferred<void>()]

  await openStudio(page)
  await page.locator("#max-concurrent-tasks").click()
  await page.getByRole("option", { name: "2" }).click()

  await page.route("**/api/images", async (route) => {
    const snapshot = parseMultipartRequest(route.request())
    intercepted.push(snapshot)
    await releases[Math.min(intercepted.length - 1, 1)].promise
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)),
    })
  })

  await page.locator("#prompt").fill("First concurrent prompt")
  await page.locator("#api-key").fill("sk-first-task")
  await page.locator("#endpoint").fill("https://first.example.test/v1")
  await page.getByRole("button", { name: /^Generate images/ }).click()

  await page.locator("#prompt").fill("Second concurrent prompt")
  await page.locator("#api-key").fill("sk-second-task")
  await page.locator("#endpoint").fill("https://second.example.test/v1")
  await page.getByRole("button", { name: /^Generate images/ }).click()

  await expect.poll(() => intercepted.length).toBe(2)
  expect(intercepted[0]?.fields.prompt).toEqual(["First concurrent prompt"])
  expect(intercepted[0]?.fields.apiKey).toEqual(["sk-first-task"])
  expect(intercepted[0]?.fields.endpoint).toEqual(["https://first.example.test/v1"])
  expect(intercepted[1]?.fields.prompt).toEqual(["Second concurrent prompt"])
  expect(intercepted[1]?.fields.apiKey).toEqual(["sk-second-task"])
  expect(intercepted[1]?.fields.endpoint).toEqual(["https://second.example.test/v1"])
  await expect(page.getByText("sk-first-task")).toHaveCount(0)
  await expect(page.getByText("sk-second-task")).toHaveCount(0)

  releases[0].resolve()
  releases[1].resolve()
  await expect(selectedResultImage(page)).toBeVisible()
})
```

Use the click/option path for the custom Base UI select. The test interacts with the visible control whose trigger id is `max-concurrent-tasks`.

- [ ] **Step 3: Write queued remove browser test**

Add:

```ts
test("queued task can be removed without sending a request @cross-browser", async ({ page }) => {
  const intercepted: MultipartSnapshot[] = []
  const releaseFirst = createDeferred<void>()

  await openStudio(page)
  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    await releaseFirst.promise
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)) })
  })

  await page.locator("#prompt").fill("Long running first task")
  await page.getByRole("button", { name: /^Generate images/ }).click()
  await expect.poll(() => intercepted.length).toBe(1)

  await page.locator("#prompt").fill("Queued task to remove")
  await page.getByRole("button", { name: /^Generate images/ }).click()
  await expect(taskRowByPrompt(page, "Queued task to remove")).toBeVisible()
  await taskRowByPrompt(page, "Queued task to remove").getByRole("button", { name: "Remove" }).click()
  await expect(taskRowByPrompt(page, "Queued task to remove")).toHaveCount(0)
  await expectSettledRequestCount(intercepted, 1, { label: "/api/images request" })

  releaseFirst.resolve()
})
```

- [ ] **Step 4: Write stop isolation browser test**

Add:

```ts
test("stopping one running task does not stop another running task @cross-browser", async ({ page }) => {
  const intercepted: MultipartSnapshot[] = []
  const releases = [createDeferred<void>(), createDeferred<void>()]

  await openStudio(page)
  await page.locator("#max-concurrent-tasks").click()
  await page.getByRole("option", { name: "2" }).click()

  await page.route("**/api/images", async (route) => {
    const index = intercepted.length
    intercepted.push(parseMultipartRequest(route.request()))
    await releases[Math.min(index, 1)].promise
    try {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)) })
    } catch {
      return
    }
  })

  await page.locator("#prompt").fill("Stop only this task")
  await page.getByRole("button", { name: /^Generate images/ }).click()
  await page.locator("#prompt").fill("Keep this task running")
  await page.getByRole("button", { name: /^Generate images/ }).click()
  await expect.poll(() => intercepted.length).toBe(2)

  await taskRowByPrompt(page, "Stop only this task").getByRole("button", { name: "Stop" }).click()
  await expect(taskRowByPrompt(page, "Stop only this task")).toContainText(/stopped/i)
  releases[1].resolve()
  await expect(taskRowByPrompt(page, "Keep this task running")).toContainText(/completed/i)
  await expectSettledRequestCount(intercepted, 2, { label: "/api/images request" })
  releases[0].resolve()
})
```

- [ ] **Step 5: Update existing partial/failure/timeout browser expectations**

Update existing tests in `tests/browser/image-studio-smoke.spec.ts`:

```ts
await expect(page.getByText(/Generated 1\/2\. Partial result kept:/)).toBeVisible()
await expect(page.getByText(/This task failed: mocked total failure/)).toBeVisible()
await expect(page.getByText(/This task was stopped/)).toBeVisible()
await expect(page.getByText(/This task timed out/)).toBeVisible({ timeout: 7_000 })
```

Keep the existing `expectSettledRequestCount()` assertions so request fan-out behavior remains covered.

- [ ] **Step 6: Run focused browser tests and verify they fail before UI fixes**

Run: `pnpm exec playwright test tests/browser/image-studio-smoke.spec.ts -g "multi-task submissions|queued task can be removed|stopping one running task|partial success|complete failure|stop while pending|timeout while pending"`

Expected: new tests fail until the UI exposes stable task rows, row actions, inline callouts, and custom-select interactions correctly.

- [ ] **Step 7: Fix UI behavior to satisfy browser tests**

Make these targeted component fixes:

```tsx
<article
  data-task-id={task.snapshot.id}
  data-task-status={status}
  className={cn("rounded-lg border bg-muted/25 p-3", isSelected && "border-primary bg-primary/5")}
>
  <button type="button" className="w-full text-left" onClick={() => onSelectTask(task.snapshot.id)}>
    <span className="line-clamp-1">{task.snapshot.prompt}</span>
  </button>
</article>
```

Ensure `TaskQueueList` row buttons have accessible names `Stop` and `Remove` from localized copy. Ensure the primary submit button is never disabled merely because `isAnyTaskRunning` is true. Ensure selected task changes when a row is clicked:

```tsx
<button type="button" className="w-full text-left" onClick={() => onSelectTask(task.snapshot.id)}>
  <span className="line-clamp-1">{task.snapshot.prompt}</span>
</button>
```

Ensure API key display uses only:

```tsx
{task.snapshot.apiKeySet ? text.keySet : text.noKey}
```

- [ ] **Step 8: Run focused browser tests and verify they pass**

Run: `pnpm exec playwright test tests/browser/image-studio-smoke.spec.ts -g "multi-task submissions|queued task can be removed|stopping one running task|partial success|complete failure|stop while pending|timeout while pending"`

Expected: all selected browser tests pass.

- [ ] **Step 9: Authorized checkpoint commit**

Run only if commit authorization is active: `git add src/components/image-studio.tsx tests/browser/image-studio-smoke.spec.ts tests/browser/image-studio-test-helpers.ts && git commit -m "test: cover image task queue behavior"`

Expected: one commit is created. If commit authorization is absent, do not commit.

---

### Task 10: Final Regression Verification

**Files:**
- Verify all changed files from the File Map

- [ ] **Step 1: Run focused source tests for new task helpers and route hardening**

Run: `pnpm exec tsx tests/image-studio-tasks.test.ts && pnpm exec tsx tests/image-route-endpoint-trust.test.ts`

Expected: both commands pass.

- [ ] **Step 2: Run component source regression tests**

Run: `pnpm exec tsx tests/image-studio-task-source.test.ts && pnpm exec tsx tests/image-studio-task-session-source.test.ts && pnpm exec tsx tests/image-studio-task-terminal-source.test.ts && pnpm exec tsx tests/image-studio-task-copy.test.ts && pnpm exec tsx tests/image-studio-task-lifecycle-source.test.ts && pnpm exec tsx tests/image-studio-task-remix-source.test.ts`

Expected: all commands pass.

- [ ] **Step 3: Run existing source regression tests that are most likely to regress**

Run: `pnpm exec tsx tests/image-studio-session.test.ts && pnpm exec tsx tests/image-studio-adaptive-request-strategy.test.ts && pnpm exec tsx tests/image-route-request-strategy-integration.test.ts && pnpm exec tsx tests/image-route-reported-fields.test.ts && pnpm exec tsx tests/image-route-timeout.test.ts && pnpm exec tsx tests/image-studio-missing-api-key-dialog.test.ts && pnpm exec tsx tests/image-studio-remember-key-dialog.test.ts && pnpm exec tsx tests/image-studio-history-window.test.ts && pnpm exec tsx tests/image-studio-history-keys.test.ts && pnpm exec tsx tests/image-studio-debug-panel.test.ts && pnpm exec tsx tests/image-studio-requested-summary.test.ts && pnpm exec tsx tests/image-studio-default-timeout.test.ts && pnpm exec tsx tests/image-studio-elapsed-timer.test.ts && pnpm exec tsx tests/image-studio-exit-confirmation.test.ts`

Expected: all commands pass.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`

Expected: ESLint exits successfully with no reported errors.

- [ ] **Step 5: Run browser smoke tests**

Run: `pnpm test:browser -- tests/browser/image-studio-smoke.spec.ts`

Expected: Playwright smoke tests pass. If cross-browser tags increase runtime, keep the full output and report any flaky test name to the coordinator.

- [ ] **Step 6: Inspect secret safety with source search**

Run: `pnpm exec tsx -e "import { readFileSync } from 'node:fs'; const files=['src/components/image-studio.tsx','src/lib/image-studio-tasks.ts']; for (const file of files) { const source=readFileSync(file,'utf8'); if (/JSON\.stringify\([^)]*apiKey|snapshot\.apiKey\}/.test(source)) throw new Error(file + ' may expose task apiKey'); }"`

Expected: command exits successfully.

- [ ] **Step 7: Check final working tree**

Run: `git status --short`

Expected: only intended files from this plan are changed. Do not revert unrelated files.

- [ ] **Step 8: Authorized final commit**

Run only if commit authorization is active: `git add src/lib/image-studio-tasks.ts src/lib/image-endpoint-trust.ts src/lib/i18n.ts src/app/api/images/route.ts src/components/image-studio.tsx tests/image-studio-tasks.test.ts tests/image-route-endpoint-trust.test.ts tests/image-studio-task-source.test.ts tests/image-studio-task-session-source.test.ts tests/image-studio-task-terminal-source.test.ts tests/image-studio-task-copy.test.ts tests/image-studio-task-lifecycle-source.test.ts tests/image-studio-task-remix-source.test.ts tests/image-studio-stop-timeout-controls.test.ts tests/image-studio-history-window.test.ts tests/image-studio-history-keys.test.ts tests/image-studio-missing-api-key-dialog.test.ts tests/image-studio-remember-key-dialog.test.ts tests/browser/image-studio-smoke.spec.ts tests/browser/image-studio-test-helpers.ts && git commit -m "feat: add concurrent image generation tasks"`

Expected: one final commit is created only when authorized. If incremental checkpoint commits already exist, skip this final commit or use it only for remaining uncommitted changes with coordinator approval.

---

## Spec Coverage Review

- True frontend multi-task image generation: Tasks 1, 3, 4, 5, 6, 9.
- User-configurable max concurrent tasks: Tasks 1, 4, 6, 9.
- Immutable task snapshots with prompt, references, model, API key, endpoint, output settings, count, timeout, locale, and derived request prompt: Tasks 1 and 4.
- Different tasks can use different model and API key: Tasks 4 and 9.
- Frontend scheduler starts up to configured concurrency and queues the rest: Tasks 1, 4, 6, 9.
- Existing `/api/images`, `runImageStudioSession()`, `executeImageStudioRequestStrategy()`, and `callImageStudioProxy()` mostly intact: Tasks 0, 2, 4, 10.
- Per-task progress, result, error, status, selected image, `AbortController`, and timeout: Tasks 1, 3, 4, 5, 7, 8.
- Stop one task without stopping others and remove queued task without requests: Tasks 6, 7, 9.
- Timeout starts when task starts running: Tasks 4 and 7.
- API keys memory-only and not in history/debug/export/display except sanitized status: Tasks 1, 2, 5, 6, 9, 10.
- Task queue/list UI in result area with selected-task result view: Tasks 5, 6, 9.
- Statuses `queued`, `running`, `completed`, `partial`, `failed`, `stopped`, `timedOut`: Tasks 1, 5, 6, 7.
- Preserve remix/iteration using selected task result: Task 8.
- Partial success visible inline: Tasks 5, 7, 9.
- Existing generation history cap continues: Tasks 1, 5, 10.
- Server env `OPENAI_API_KEY` must not be sent to arbitrary custom endpoints: Task 2.
- Custom endpoints require user API key unless trusted by server-side allowlist: Task 2.
- Queued/running tasks are not persisted across reload: Tasks 3, 4, 10.
- Next.js 16 docs are read before route code changes: Task 0.
- TDD flow with failing tests before implementation: Tasks 1 through 9.

## Red-Flag Scan

- Every task names exact files, commands, and expected results.
- New types and functions use consistent names: `ImageTaskStatus`, `ImageTaskSnapshot`, `ImageTask`, `ImageTaskHistoryResult`, `createImageTaskSnapshot`, `createQueuedImageTask`, `getNextRunnableTaskIds`, `sanitizeImageTaskSnapshot`, `createHistoryResultFromTask`, `startTask`, `runTask`, `completeTaskFromSessionResult`, `completeTaskFromError`, `clearTaskRuntime`, `stopTask`, `removeQueuedTask`, and `updateTaskSelectedImageIndex`.
- The plan avoids deferred-detail markers and names the concrete behavior for validation, sanitization, route rejection, runtime cleanup, and inline status display.
- Commit commands are explicit and gated by user or coordinator authorization.

## Implementation Risks

- `src/components/image-studio.tsx` is large, so source-level tests should be kept focused and browser tests should verify actual task behavior after the refactor.
- React Strict Mode can duplicate scheduler effects if task starts are not guarded by `runningTaskIdsRef`; Task 4 explicitly guards starts by task id.
- Multiple queued tasks hold `File` objects and generated data URLs in memory; Task 6 caps concurrency at `1..4` and Task 10 preserves bounded history.
- Browser tests for custom Base UI selects may need selector adjustment to match rendered accessibility roles; keep the test intent unchanged and update only the interaction path.
