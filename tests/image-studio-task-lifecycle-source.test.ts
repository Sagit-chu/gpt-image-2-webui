import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

function extractFunctionBody(functionName: string) {
  const functionMatch = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`).exec(source)

  assert.ok(functionMatch?.index !== undefined, `missing function ${functionName}`)

  const openBraceIndex = source.indexOf("{", functionMatch.index)
  assert.notEqual(openBraceIndex, -1, `missing function body for ${functionName}`)

  let depth = 0

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const character = source[index]

    if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1

      if (depth === 0) {
        return source.slice(openBraceIndex + 1, index)
      }
    }
  }

  assert.fail(`unterminated function body for ${functionName}`)
}

function extractSection(startNeedle: string, endNeedle: string) {
  const startIndex = source.indexOf(startNeedle)
  assert.notEqual(startIndex, -1, `missing source section starting with ${startNeedle}`)

  const endIndex = source.indexOf(endNeedle, startIndex + startNeedle.length)
  assert.notEqual(endIndex, -1, `missing source section ending with ${endNeedle}`)

  return source.slice(startIndex, endIndex)
}

const clearTaskRuntimeBody = extractFunctionBody("clearTaskRuntime")
const completeTaskFromErrorBody = extractFunctionBody("completeTaskFromError")
const completeTaskFromSessionResultBody = extractFunctionBody("completeTaskFromSessionResult")
const removeQueuedTaskBody = extractFunctionBody("removeQueuedTask")
const runTaskBody = extractFunctionBody("runTask")
const startTaskBody = extractFunctionBody("startTask")
const enqueueGenerationTaskBody = extractFunctionBody("enqueueGenerationTask")
const taskQueueListSource = source.match(/function TaskQueueList\([\s\S]*?\n}\n\nfunction EmptyResultState/)?.[0] ?? ""
const taskStatusCalloutSource = source.match(/function TaskStatusCallout\([\s\S]*?\n}\n\nfunction GenerationSkeleton/)?.[0] ?? ""
const selectedTaskTerminalDisplay = extractSection(
  '              {selectedTask?.status === "running" && !selectedTaskHasImages && (',
  '              {selectedTaskHasImages && selectedTask && ('
)
const noImageFailedDisplay = extractSection(
  '              {selectedTask?.status === "failed" && !selectedTaskHasImages && (',
  '              {selectedTask?.status === "stopped" && !selectedTaskHasImages && ('
)
const noImageStoppedDisplay = extractSection(
  '              {selectedTask?.status === "stopped" && !selectedTaskHasImages && (',
  '              {selectedTask?.status === "timedOut" && !selectedTaskHasImages && ('
)
const noImageTimedOutDisplay = extractSection(
  '              {selectedTask?.status === "timedOut" && !selectedTaskHasImages && (',
  '            </div>\n\n            {history.length > 0 && ('
)

assert.match(source, /function clearTaskRuntime\(taskId: string\)/, "runtime cleanup should be per task")
assert.match(clearTaskRuntimeBody, /taskTimeoutsRef\.current\.get\(taskId\)/, "cleanup should read timeout by task id")
assert.match(clearTaskRuntimeBody, /taskAbortControllersRef\.current\.delete\(taskId\)/, "cleanup should delete only the completed task controller")
assert.match(clearTaskRuntimeBody, /runningTaskIdsRef\.current\.delete\(taskId\)/, "cleanup should delete only the completed running marker")
assert.match(source, /function removeQueuedTask\(taskId: string\)/, "queued task removal should have a dedicated handler")
assert.match(removeQueuedTaskBody, /task\.snapshot\.id\s*!==\s*taskId|task\.snapshot\.id\s*===\s*taskId/, "removeQueuedTask should match tasks by id")
assert.match(removeQueuedTaskBody, /task\.status\s*!==\s*"queued"|task\.status\s*===\s*"queued"/, "removeQueuedTask should filter only queued tasks")
assert.match(source, /task\.status === "partial"[\s\S]*t\(taskLocale, "taskPartialInline"/, "partial status should have inline selected-task copy")
assert.match(source, /task\.status === "failed"[\s\S]*t\(taskLocale, "taskFailedInline"/, "failed status should have inline selected-task copy")
assert.match(source, /task\.status === "stopped"[\s\S]*t\(taskLocale, "taskStoppedInline"/, "stopped status should have inline selected-task copy")
assert.match(source, /task\.status === "timedOut"[\s\S]*t\(taskLocale, "taskTimedOutInline"/, "timedOut status should have inline selected-task copy")
assert.match(noImageStoppedDisplay, /taskStoppedInline/, "no-image stopped display should use stopped inline task copy")
assert.match(noImageTimedOutDisplay, /taskTimedOutInline/, "no-image timedOut display should use timedOut inline task copy")
assert.match(selectedTaskTerminalDisplay, /selectedTask\.status === "partial"/, "partial selected-task callout should render without requiring preserved images")
assert.match(selectedTaskTerminalDisplay, /selectedTaskHasImages[\s\S]*"failed"/, "failed selected-task callout should require preserved images")
assert.match(noImageFailedDisplay, /taskFailedInline/, "no-image failed display should use failed inline task copy")
assert.ok(taskQueueListSource, "TaskQueueList source should be present")
assert.ok(taskStatusCalloutSource, "TaskStatusCallout source should be present")
assert.match(taskQueueListSource, /aria-label=\{`\$\{text\.stopGeneration\}: \$\{task\.snapshot\.prompt\}`\}/, "running task stop action should include task prompt in its accessible label")
assert.match(taskQueueListSource, /aria-label=\{`\$\{text\.removeQueuedTask\}: \$\{task\.snapshot\.prompt\}`\}/, "queued task remove action should include task prompt in its accessible label")
assert.match(source, /<TaskStatusCallout task=\{selectedTask\} \/>/, "selected task callout should render directly from the task snapshot")
assert.doesNotMatch(source, /<TaskStatusCallout locale=\{locale\} task=\{selectedTask\} text=\{text\} \/>/, "selected task callout should not read live UI locale props")
assert.match(taskStatusCalloutSource, /const taskLocale = task\.snapshot\.locale/, "selected-task inline callout should derive locale from the task snapshot")
assert.match(taskStatusCalloutSource, /const taskText = studioMessages\[taskLocale\]/, "selected-task inline callout should derive copy from the task snapshot locale")
assert.match(taskStatusCalloutSource, /pluralSuffix\(taskLocale, count\)/, "selected-task inline callout should pluralize from the task snapshot locale")
assert.match(completeTaskFromSessionResultBody, /errorMessage:\s*getGenerationErrorMessage\(sessionResult\.firstError,\s*taskText\.allRequestsFailed\)/, "no-image failed tasks should store fallback copy from the task locale")
assert.match(completeTaskFromSessionResultBody, /partialErrorMessage:[\s\S]{0,140}taskText\.generationFailed/, "partial tasks should store fallback copy from the task locale")
assert.doesNotMatch(completeTaskFromSessionResultBody, /errorMessage:\s*getGenerationErrorMessage\(sessionResult\.firstError,\s*text\.allRequestsFailed\)/, "no-image failed fallback copy should not use the current UI locale")
assert.doesNotMatch(completeTaskFromSessionResultBody, /partialErrorMessage:[\s\S]{0,140}text\.generationFailed/, "partial fallback copy should not use the current UI locale")
assert.doesNotMatch(completeTaskFromErrorBody, /fallbackMessage:\s*text\./, "error terminal fallback copy should not use the current UI locale")
assert.match(completeTaskFromErrorBody, /studioMessages\[item\.snapshot\.locale\]\.generationStopped/, "stopped fallback copy should use the task locale")
assert.match(completeTaskFromErrorBody, /studioMessages\[item\.snapshot\.locale\]\.generationFailed/, "failed fallback copy should use the task locale")
assert.match(runTaskBody, /if \(isMountedRef\.current\) \{\s*completeTaskFromSessionResult\(taskId, sessionResult\)\s*\}/, "runTask should not complete successful task state or toast after unmount")
assert.match(runTaskBody, /catch \(error\) \{\s*if \(isMountedRef\.current\) \{\s*completeTaskFromError\(taskId, error, completedCount\)\s*\}\s*\} finally/, "runTask should not complete failed task state or toast after unmount")
assert.match(startTaskBody, /tasksRef\.current\.find\([\s\S]*status === "queued"[\s\S]*window\.setTimeout\(/, "startTask should select a queued task before creating a timeout")
assert.match(startTaskBody, /taskTimeoutsRef\.current\.set\(taskId, timeoutId\)/, "startTask should key timeout refs by task id")
assert.doesNotMatch(enqueueGenerationTaskBody, /window\.setTimeout\(|taskTimeoutsRef\.current\.set|taskAbortControllersRef\.current\.set|runningTaskIdsRef\.current\.add/, "enqueueGenerationTask should not create task runtime state")
