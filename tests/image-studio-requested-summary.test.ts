import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /result\.qualityReported[\s\S]*qualityLabelByValue\[result\.quality\] \|\| result\.quality[\s\S]*text\.summaryRequested/,
  "quality summary should mark request-only values when the API does not report an applied quality"
)

assert.match(
  source,
  /sizeReported \? result\.size : `\$\{result\.size\} \(\$\{text\.summaryRequested\}\)`/,
  "size summary should mark request-only values when the API does not report an applied size"
)
