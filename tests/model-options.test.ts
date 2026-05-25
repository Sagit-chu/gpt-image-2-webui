import assert from "node:assert/strict"

import { DEFAULT_MODEL, modelItems } from "../src/lib/model-options"

function main() {
  assert.equal(DEFAULT_MODEL, "gpt-image-2")
  assert.deepEqual(modelItems, [
    { label: "gpt-image-2", value: "gpt-image-2" },
    { label: "gemini-3.1-flash-image", value: "gemini-3.1-flash-image" },
  ])
}

main()
