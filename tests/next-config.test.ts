import assert from "node:assert/strict"

import nextConfig from "../next.config.ts"

function main() {
  assert.equal(nextConfig.experimental?.proxyClientMaxBodySize, "50mb")
}

main()
