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
assert.equal("references" in sanitized, false)

const bounded = updateTaskImages(makeTask("bounded", "running"), [
  { src: "data:image/png;base64,one" },
])
assert.equal(bounded.selectedImageIndex, 0)

const completed = {
  ...makeTask("history", "completed"),
  debug: {
    apiKey: "sk-debug-secret",
    nested: [
      reference,
      {
        apiKey: "sk-nested-secret",
        files: [reference],
        safe: "keep me",
      },
    ],
    references: [reference],
    snapshot,
  },
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
assert.equal(JSON.stringify(historyResult).includes("reference-bytes"), false)
assert.equal(JSON.stringify(historyResult).includes("keep me"), true)
assert.deepEqual(historyResult.debug, {
  apiKey: "",
  nested: [
    {
      apiKey: "",
      files: [],
      safe: "keep me",
    },
  ],
  references: [],
  snapshot: {
    ...sanitized,
  },
})

assert.equal(isTerminalTaskStatus("queued"), false)
assert.equal(isTerminalTaskStatus("running"), false)
assert.equal(isTerminalTaskStatus("completed"), true)
assert.equal(isTerminalTaskStatus("partial"), true)
assert.equal(isTerminalTaskStatus("failed"), true)
assert.equal(isTerminalTaskStatus("stopped"), true)
assert.equal(isTerminalTaskStatus("timedOut"), true)
