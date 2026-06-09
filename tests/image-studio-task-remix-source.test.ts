import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(source, /const selectedTaskImage = selectedTask\?\.images\[selectedTask\.selectedImageIndex\] \|\| selectedTask\?\.images\[0\] \|\| null/, "selected image should come from selected task")
assert.match(source, /function updateTaskSelectedImageIndex\(taskId: string, imageIndex: number\)/, "image selection should update the selected task")
assert.match(source, /const image = selectedTask\?\.images\[index\]/, "setGeneratedImageAsSource should read selected task images")
assert.match(source, /promptSnapshot: image\.revisedPrompt \|\| selectedTask\.snapshot\.prompt,/, "active remix source should use the selected task prompt snapshot")
assert.doesNotMatch(source, /promptSnapshot:\s*image\.revisedPrompt \|\| selectedTask\.snapshot\.prompt \|\| prompt\.trim\(\)/, "selected-result remix source should not fall back to live prompt state")
assert.match(source, /round: selectedTask\?\.snapshot\.generation \|\| 1/, "active remix source should preserve selected task generation")
assert.match(source, /image=\{selectedTaskImage\}/, "RemixPanel should receive selected task image")
assert.match(source, /prompt=\{selectedTask\.snapshot\.prompt\}/, "RemixPanel prompt should use the selected task prompt snapshot")
assert.doesNotMatch(source, /prompt=\{selectedTask\?\.snapshot\.prompt \|\| prompt\}/, "selected-result remix panel should not fall back to the live form prompt")
