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
