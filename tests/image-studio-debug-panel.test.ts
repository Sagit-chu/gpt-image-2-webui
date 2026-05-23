import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /result\.debug && \(\s*<details[\s\S]*text\.debugPanelTitle[\s\S]*text\.debugPanelDescription[\s\S]*text\.debugRequest[\s\S]*text\.debugResponse/,
  "the result footer should expose a collapsible debug panel when debug data is available"
)

assert.match(
  source,
  /JSON\.stringify\(result\.debug\.request,\s*null,\s*2\)/,
  "the debug panel should render the submitted request as formatted JSON"
)

assert.match(
  source,
  /JSON\.stringify\(result\.debug\.response,\s*null,\s*2\)/,
  "the debug panel should render the upstream response as formatted JSON"
)

assert.doesNotMatch(
  source,
  /function DebugField\(/,
  "the debug panel should no longer render field-by-field tables"
)
