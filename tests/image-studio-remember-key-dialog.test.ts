import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /function promptToRememberApiKey\(\)\s*\{[\s\S]*?setIsRememberDialogOpen\(true\)[\s\S]*?\}/,
  "image studio should centralize the API key remember prompt so blur and submit use the same behavior"
)

assert.match(
  source,
  /if \(promptToRememberApiKey\(\)\) \{\s*return\s*\}/,
  "submitting with an unsaved API key should show the remember prompt before starting generation"
)
