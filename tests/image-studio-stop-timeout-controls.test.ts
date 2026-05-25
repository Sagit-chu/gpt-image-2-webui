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
  /formData\.append\("timeoutMs", String\(requestTimeoutMs\)\)/,
  "image studio should send the configured timeout to the server proxy"
)

assert.match(
  source,
  /new AbortController\(\)/,
  "image studio should create an AbortController for each generation run"
)

assert.match(
  source,
  /signal:\s*generationController\.signal/,
  "proxy requests should use the generation abort signal so the stop action cancels in-flight work"
)

assert.match(
  source,
  /text\.stopGeneration/,
  "the UI should expose localized copy for stopping an in-flight generation"
)
