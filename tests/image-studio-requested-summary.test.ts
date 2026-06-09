import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /selectedTask\.qualityReported[\s\S]*qualityLabelByValue\[selectedTask\.quality\] \|\| selectedTask\.quality[\s\S]*text\.summaryRequested/,
  "quality summary should mark request-only values when the API does not report an applied quality"
)

assert.match(
  source,
  /selectedTask\.sizeReported \? selectedTask\.size : `\$\{selectedTask\.size\} \(\$\{text\.summaryRequested\}\)`/,
  "size summary should mark request-only values when the API does not report an applied size"
)

assert.doesNotMatch(
  source,
  /result\.(quality|size)/,
  "requested summary rendering should come from the selected task instead of singleton result state"
)
