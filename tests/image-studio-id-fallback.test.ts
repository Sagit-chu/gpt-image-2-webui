import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /function createClientId\(\)\s*\{[\s\S]*globalThis\.crypto\?\.randomUUID[\s\S]*getRandomValues[\s\S]*Math\.random/,
  "client-side ids should fall back when randomUUID is unavailable"
)

assert.doesNotMatch(
  source,
  /(?<!globalThis\.)crypto\.randomUUID\(/,
  "the studio should not call crypto.randomUUID directly in browser code"
)
