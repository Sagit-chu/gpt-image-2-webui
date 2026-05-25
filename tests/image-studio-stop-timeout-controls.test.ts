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
  /new AbortController\(\)/,
  "image studio should create an AbortController for each generation run"
)

assert.match(
  source,
  /runImageStudioSession(?:<[^>]+>)?\(\{[\s\S]*signal:\s*generationController\.signal,[\s\S]*timeoutMs:\s*requestTimeoutMs,[\s\S]*\}\)/,
  "image studio should pass the generation abort signal and timeout through the shared session helper"
)

assert.match(
  source,
  /text\.stopGeneration/,
  "the UI should expose localized copy for stopping an in-flight generation"
)
