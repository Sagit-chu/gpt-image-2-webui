import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /window\.addEventListener\("beforeunload",\s*handleBeforeUnload\)/,
  "image studio should register a beforeunload listener so refresh and close show a confirmation dialog"
)

assert.match(
  source,
  /window\.removeEventListener\("beforeunload",\s*handleBeforeUnload\)/,
  "image studio should remove the beforeunload listener during cleanup"
)

assert.match(
  source,
  /event\.preventDefault\(\)\s*\n\s*event\.returnValue = ""/,
  "beforeunload handler should trigger the browser confirmation requirement"
)
