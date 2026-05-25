import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /function promptToRememberApiKey\(\)\s*\{[\s\S]*?if \(!apiKey\.trim\(\) \|\| rememberKey\) \{\s*return false\s*\}[\s\S]*?setIsRememberDialogOpen\(true\)[\s\S]*?return true[\s\S]*?\}/,
  "image studio should only open the remember dialog for a non-empty unsaved API key"
)

assert.match(
  source,
  /if \(promptToRememberApiKey\(\)\) \{\s*return\s*\}/,
  "submitting with an unsaved API key should show the remember prompt before starting generation"
)

assert.doesNotMatch(
  source,
  /if \(!apiKey\.trim\(\)\) \{\s*setIsRememberDialogOpen\(true\)/,
  "an empty API key should not trigger the remember dialog"
)
