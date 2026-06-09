import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")
const setGeneratedImageAsSource = source.match(/async function setGeneratedImageAsSource\([\s\S]*?\n  async function copyPromptToClipboard/)?.[0] ?? ""
const selectedCanvasHeader = source.match(/<div className="relative flex items-center justify-between[\s\S]*?<div className="relative flex-1 overflow-y-auto/)?.[0] ?? ""
const taskQueueListSource = source.match(/function TaskQueueList\([\s\S]*?\n}\n\nfunction EmptyResultState/)?.[0] ?? ""

assert.match(source, /function completeTaskFromSessionResult\(/, "successful and partial sessions should use a terminal transition helper")
assert.match(source, /status:\s*sessionResult\.isPartial \? "partial" : "completed"/, "session partial flag should become task status")
assert.match(source, /partialErrorMessage:\s*sessionResult\.isPartial/, "partial tasks should keep inline-readable error state")
assert.match(source, /function completeTaskFromError\(/, "errors should use a terminal transition helper")
assert.match(source, /isGenerationControlError\(error, "GenerationAbortError"\)[\s\S]*status:\s*"stopped"/, "abort control errors should become stopped tasks")
assert.match(source, /isGenerationControlError\(error, "GenerationTimeoutError"\)[\s\S]*status:\s*"timedOut"/, "timeout control errors should become timedOut tasks")
assert.match(source, /sanitizeImageTaskSnapshot\(item\.snapshot\)/, "terminal transitions should sanitize API keys from task snapshots")
assert.match(source, /createHistoryResultFromTask<StudioDebug>\(terminalTask\)/, "completed and partial tasks should feed sanitized history")
assert.ok(taskQueueListSource, "TaskQueueList source should be present")
assert.match(taskQueueListSource, /const terminalDurationSeconds = task\.startedAt && task\.completedAt \? Math\.max\(0, Math\.floor\(\(task\.completedAt - task\.startedAt\) \/ 1000\)\) : null/, "terminal task rows should compute duration from started and completed timestamps")
assert.match(taskQueueListSource, /status !== "queued" && status !== "running"[\s\S]*terminalDurationSeconds[\s\S]*<span>\{terminalDurationSeconds\}s<\/span>/, "terminal task rows should render duration metadata")
assert.match(source, /prompt=\{selectedTask\.snapshot\.prompt\}/, "selected task remix panel should use the task prompt snapshot instead of the live form prompt")
assert.doesNotMatch(source, /prompt=\{prompt\}/, "selected task result rendering should not pass the live form prompt to the remix panel")
assert.match(
  selectedCanvasHeader,
  /selectedTask\.snapshot\.apiKeySet \? text\.keySet : text\.noKey/,
  "selected result header should show selected task key state"
)
assert.match(
  selectedCanvasHeader,
  /selectedTask\.endpoint \|\| selectedTask\.snapshot\.endpoint/,
  "selected result header should show selected task endpoint metadata"
)
assert.doesNotMatch(
  selectedCanvasHeader,
  /apiKey \? text\.keySet : text\.noKey/,
  "selected result header should not show live form API key state"
)
assert.doesNotMatch(
  selectedCanvasHeader,
  /\{endpoint\}/,
  "selected result header should not show live form endpoint"
)
assert.match(
  setGeneratedImageAsSource,
  /promptSnapshot:\s*image\.revisedPrompt \|\| selectedTask\.snapshot\.prompt/,
  "selected-result remix source should use selected task prompt metadata"
)
assert.doesNotMatch(
  setGeneratedImageAsSource,
  /prompt\.trim\(\)/,
  "selected-result remix source should not fall back to live prompt state"
)
assert.match(
  source,
  /image\.revisedPrompt && \([\s\S]{0,320}\{selectedTask\.snapshot\.prompt\}[\s\S]{0,120}<\/Badge>/,
  "selected result card revised-prompt badge should display the selected task prompt snapshot"
)
assert.doesNotMatch(
  source,
  /image\.revisedPrompt && \([\s\S]{0,220}>\s*prompt\s*<\/Badge>/,
  "selected result card revised-prompt badge should not display the live form prompt"
)
assert.match(
  source,
  /\[text\.summaryRefs, String\(selectedTask\.snapshot\.referenceNames\.length\)\]/,
  "selected task summary should count persisted reference names, not sanitized File references"
)
assert.doesNotMatch(
  source,
  /\[text\.summaryRefs, String\(selectedTask\.snapshot\.references\.length\)\]/,
  "selected task summary should not read sanitized File references for terminal tasks"
)
assert.match(
  source,
  /selectedTask && \([\s\S]{0,240}selectedTask\.status === "partial"[\s\S]{0,180}selectedTaskHasImages && \["failed", "stopped", "timedOut"\]\.includes\(selectedTask\.status\)[\s\S]{0,120}<TaskStatusCallout/,
  "failed, stopped, and timed-out task callouts should only render when preserved images exist"
)
assert.doesNotMatch(
  source,
  /\["partial", "failed", "stopped", "timedOut"\]\.includes\(selectedTask\.status\)[\s\S]{0,160}<TaskStatusCallout/,
  "no-image failed, stopped, and timed-out tasks should not render both a callout and an empty state"
)
