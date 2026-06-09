import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  createHistoryResultFromTask,
  createImageTaskSnapshot,
  createQueuedImageTask,
  type ImageTask,
} from "../src/lib/image-studio-tasks"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")
const completeTaskFromSessionResult = source.match(/function completeTaskFromSessionResult\([\s\S]*?\n  function completeTaskFromError\(/)?.[0] ?? ""
const completeTaskFromError = source.match(/function completeTaskFromError\([\s\S]*?\n  function clearTaskRuntime\(/)?.[0] ?? ""

assert.match(
  source,
  /type StudioResponse = ImageTaskHistoryResult<StudioDebug>/,
  "studio history results should use the shared task history result type"
)

assert.match(
  source,
  /createHistoryResultFromTask<StudioDebug>\(terminalTask\)/,
  "terminal tasks should be converted into sanitized history results through the shared helper"
)

assert.match(
  source,
  /if \(terminalTask\.status !== "completed" && terminalTask\.status !== "partial"\) return/,
  "only completed and partial tasks should be promoted into history"
)

assert.match(
  source,
  /appendImageStudioHistory\(current, historyResult, IMAGE_STUDIO_HISTORY_LIMIT\)/,
  "history state should receive only the sanitized helper result"
)

assert.match(
  completeTaskFromSessionResult,
  /const sanitizedSnapshot = sanitizeImageTaskSnapshot\(item\.snapshot\)[\s\S]*apiKey: sanitizedSnapshot\.apiKey,[\s\S]*references: \[\]/,
  "session terminal task transitions should drop API keys and file references"
)

assert.match(
  completeTaskFromError,
  /const sanitizedSnapshot = sanitizeImageTaskSnapshot\(item\.snapshot\)[\s\S]*apiKey: sanitizedSnapshot\.apiKey,[\s\S]*references: \[\]/,
  "error terminal task transitions should drop API keys and file references"
)

assert.doesNotMatch(
  source,
  /function sanitizeStoredTerminalTask\(/,
  "terminal snapshot sanitization should not be hidden in an unused helper"
)

assert.doesNotMatch(
  source,
  /appendImageStudioHistory\(current, (?:terminalTask|task|.*snapshot|.*apiKey)/,
  "history state should not receive raw task snapshots or API keys"
)

assert.doesNotMatch(
  source,
  /void sanitizeImageTaskSnapshot\(terminalTask\.snapshot\)/,
  "terminal task snapshot sanitization should not discard the sanitized value"
)

const reference = new File(["reference-bytes"], "reference.png", { type: "image/png" })
const snapshot = createImageTaskSnapshot({
  apiKey: "sk-history-secret",
  background: "auto",
  endpoint: "https://snapshot-user:snapshot-pass@snapshot.example.test/v1",
  generation: 1,
  id: "credential-history",
  imageCount: 1,
  locale: "en",
  model: "gpt-image-2",
  outputFormat: "png",
  prompt: "credential history prompt",
  quality: "high",
  references: [reference],
  requestPrompt: "credential history prompt",
  size: "1024x1024",
  submittedAt: 1,
  timeoutMs: 180_000,
})
const task = {
  ...createQueuedImageTask(snapshot),
  debug: {
    request: {
      endpoint: "https://request-user:request-pass@debug.example.test/v1/images/generations",
    },
    response: {
      endpoint: "https://response-user:response-pass@debug.example.test/v1/images/generations",
    },
    snapshot,
  },
  endpoint: "https://task-user:task-pass@task.example.test/v1/images/generations",
  images: [{ src: "data:image/png;base64,one" }],
  status: "completed",
} satisfies ImageTask
const historyResult = createHistoryResultFromTask(task)

assert.ok(historyResult)
assert.equal(historyResult.endpoint, "https://task.example.test/v1/images/generations")
assert.equal(historyResult.debug?.request?.endpoint, "https://debug.example.test/v1/images/generations")
assert.equal(historyResult.debug?.response?.endpoint, "https://debug.example.test/v1/images/generations")
assert.equal(historyResult.debug?.snapshot?.endpoint, "https://snapshot.example.test/v1")
assert.doesNotMatch(JSON.stringify(historyResult), /(?:request|response|snapshot|task)-(?:user|pass)/)
