import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /id: string\s*\n\s*generation: number/,
  "studio history results need a stable unique id in addition to display generation"
)

assert.match(
  source,
  /id: crypto\.randomUUID\(\),[\s\S]*?generation: nextGeneration/,
  "new studio results should get a unique id when created"
)

assert.match(
  source,
  /history\.map\(\(pastResult\) => \(\s*<section key=\{pastResult\.id\}/,
  "history sections should use the stable result id as their React key"
)

assert.match(
  source,
  /key=\{`\$\{pastResult\.id\}-\$\{index\}`\}/,
  "history image cards should include the stable result id in their React key"
)

assert.doesNotMatch(
  source,
  /setResult\(\(prev\) => \{[\s\S]*?setHistory\(/,
  "result state updaters must stay pure so React Strict Mode cannot push the same result into history twice"
)
