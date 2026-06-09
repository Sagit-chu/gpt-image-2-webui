import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /const \[requestTimeoutSeconds, setRequestTimeoutSeconds\] = useState\(/,
  "image studio should keep timeout control state so users can configure request deadlines"
)

assert.match(
  source,
  /taskAbortControllersRef\.current\.set\(taskId, taskController\)/,
  "image studio should key each running task AbortController by task id"
)

assert.match(
  source,
  /taskTimeoutsRef\.current\.set\(taskId, timeoutId\)/,
  "image studio should key each running task timeout by task id"
)

assert.match(
  source,
  /runImageStudioSession(?:<[^>]+>)?\(\{[\s\S]*signal:\s*taskController\.signal,[\s\S]*timeoutMs:\s*task\.snapshot\.timeoutMs,[\s\S]*\}\)/,
  "image studio should pass the task abort signal and task snapshot timeout through the shared session helper"
)

assert.match(
  source,
  /function stopTask\(taskId: string\)/,
  "the UI should stop in-flight generations by task id"
)
