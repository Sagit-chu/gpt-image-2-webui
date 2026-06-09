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
assert.match(source, /const schedulerTimeoutRef = useRef<number \| null>\(null\)/, "queued task scheduler timeout should be tracked")
assert.match(source, /const isMountedRef = useRef\(true\)/, "task scheduler should know whether ImageStudio is still mounted")
assert.match(source, /async function enqueueGenerationTask\(\s*requestApiKey\?: string/, "task submission should use a named enqueue boundary for later scheduler work")
assert.match(source, /async function startTask\(taskId: string\)/, "task execution should use a task-id based start boundary for later scheduler work")
assert.match(source, /getNextRunnableTaskIds\(tasksRef\.current, clampMaxConcurrentTasks\(maxConcurrentTasks\)\)[\s\S]*startTask\(taskId\)/, "runnable task selection should dispatch by task id")
assert.match(source, /if \(!isMountedRef\.current\) return[\s\S]*getNextRunnableTaskIds\(tasksRef\.current, clampMaxConcurrentTasks\(maxConcurrentTasks\)\)/, "queued tasks should not start after ImageStudio unmounts")
assert.match(source, /schedulerTimeoutRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*startRunnableQueuedTasks\(\)[\s\S]*\}, 0\)/, "follow-up runnable task scheduling should be tracked")
assert.match(source, /if \(schedulerTimeoutRef\.current\) \{[\s\S]*window\.clearTimeout\(schedulerTimeoutRef\.current\)[\s\S]*\}/, "unmount cleanup should clear tracked scheduler timeout")
assert.match(source, /useEffect\(\(\) => \{\s*isMountedRef\.current = true[\s\S]*return \(\) => \{\s*isMountedRef\.current = false/, "mount cleanup effect should re-arm mounted state during setup for Strict Mode replay")
assert.match(source, /async function runTask\(task: ImageTask<StudioDebug>, taskController: AbortController\)/, "task session execution should stay isolated behind the task-id scheduler boundary")
assert.doesNotMatch(source, /const \[result, setResult\] = useState<StudioResponse \| null>/, "selected task should replace singleton result state")
assert.doesNotMatch(source, /disabled=\{isGenerating\}/, "submitting a new task should remain available while other tasks run")
