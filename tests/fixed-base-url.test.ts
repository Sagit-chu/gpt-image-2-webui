import assert from "node:assert/strict"

import { resolveFixedBaseUrl } from "../src/lib/runtime-config.ts"

function main() {
  assert.equal(resolveFixedBaseUrl(undefined), null)
  assert.equal(resolveFixedBaseUrl("  "), null)
  assert.equal(resolveFixedBaseUrl("https://api.hostcentral.cc/v1/"), "https://api.hostcentral.cc/v1")
  assert.equal(resolveFixedBaseUrl("https://api.hostcentral.cc/v1"), "https://api.hostcentral.cc/v1")
}

main()
