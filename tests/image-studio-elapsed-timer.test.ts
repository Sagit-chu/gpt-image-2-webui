import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /const \[elapsedNow, setElapsedNow\] = useState\(\(\) => Date\.now\(\)\)/,
  "generation status needs tick state so selected-task timer updates re-render the UI"
)

assert.match(
  source,
  /window\.setInterval\(\(\) => setElapsedNow\(Date\.now\(\)\),\s*1000\s*\)/,
  "generation status should refresh selected-task elapsed time every second while a task is running"
)

assert.match(
  source,
  /const selectedTaskElapsedSeconds = selectedTaskStartedAt[\s\S]*elapsedNow - selectedTaskStartedAt[\s\S]*\{selectedTaskElapsedSeconds\}s/,
  "generation status should render selectedTaskElapsedSeconds derived from tick state instead of calculating Date.now() during render"
)

assert.doesNotMatch(
  source,
  /elapsedGenerationSeconds/,
  "elapsed timer rendering should not depend on singleton generation timer state"
)
