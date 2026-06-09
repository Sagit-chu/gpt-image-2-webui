import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /function promptToRememberApiKey\([^)]*\)\s*\{[\s\S]*?if \(!apiKey\.trim\(\) \|\| rememberKey\) \{\s*return false\s*\}[\s\S]*?setIsRememberDialogOpen\(true\)[\s\S]*?return true[\s\S]*?\}/,
  "image studio should only open the remember dialog for a non-empty unsaved API key"
)

assert.match(
  source,
  /id="api-key"[\s\S]*?onBlur=\{promptToRememberApiKey\}/,
  "the main API key field should still prompt to remember the key on blur"
)

assert.match(
  source,
  /if \(promptToRememberApiKey\(\)\) \{\s*return\s*\}/,
  "submitting with an unsaved API key should show the remember prompt before enqueuing generation"
)

assert.match(
  source,
  /const rememberKeyEditedBeforeHydrationRef = useRef\(false\)/,
  "image studio should track remember-key changes made before deferred preference hydration finishes"
)

assert.match(
  source,
  /rememberKeyEditedBeforeHydrationRef\.current = true/,
  "image studio should mark remember-key choices as user edits before hydration completes"
)

assert.match(
  source,
  /setRememberKey\(\(current\) => rememberKeyEditedBeforeHydrationRef\.current \? current : preferences\.remember\)/,
  "deferred preference hydration should not overwrite a remember choice made by the user first"
)

assert.doesNotMatch(
  source,
  /if \(!apiKey\.trim\(\)\) \{\s*setIsRememberDialogOpen\(true\)/,
  "an empty API key should not trigger the remember dialog"
)
