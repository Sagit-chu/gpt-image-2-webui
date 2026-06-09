import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")
const debugPanelSource = source.match(/\{selectedTask\.debug && \([\s\S]*?<\/details>\s*\)\}/)?.[0] || ""

assert.match(
  source,
  /selectedTask\.debug && \(\s*<details[\s\S]*text\.debugPanelTitle[\s\S]*text\.debugPanelDescription[\s\S]*text\.debugRequest[\s\S]*text\.debugResponse/,
  "the result footer should expose a collapsible debug panel when selected task debug data is available"
)

assert.ok(debugPanelSource, "selected task debug panel source should be present")

assert.match(
  debugPanelSource,
  /JSON\.stringify\(selectedTask\.debug\.request,\s*null,\s*2\)/,
  "the debug panel should render the submitted request as formatted JSON"
)

assert.match(
  debugPanelSource,
  /JSON\.stringify\(selectedTask\.debug\.response,\s*null,\s*2\)/,
  "the debug panel should render the upstream response as formatted JSON"
)

assert.doesNotMatch(
  debugPanelSource,
  /snapshot\.apiKey|\.apiKey/,
  "the debug panel should not render raw API key fields"
)

assert.doesNotMatch(
  source,
  /result\.debug/,
  "debug rendering should come from the selected task instead of singleton result state"
)

assert.doesNotMatch(
  source,
  /function DebugField\(/,
  "the debug panel should no longer render field-by-field tables"
)
