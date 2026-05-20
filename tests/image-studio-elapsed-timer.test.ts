import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /const \[elapsedGenerationSeconds, setElapsedGenerationSeconds\] = useState\(0\)/,
  "generation status needs elapsed seconds state so timer ticks re-render the UI"
)

assert.match(
  source,
  /window\.setInterval\(\s*updateElapsedGenerationSeconds,\s*1000\s*\)/,
  "generation status should refresh elapsed seconds every second while a request is running"
)

assert.match(
  source,
  /\{elapsedGenerationSeconds\}s/,
  "generation status should render elapsedGenerationSeconds instead of calculating Date.now() during render"
)
