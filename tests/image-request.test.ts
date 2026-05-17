import assert from "node:assert/strict"

import { extractGeneratedImages } from "../src/lib/image-request"

const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b5mQAAAAASUVORK5CYII="

function main() {
  const images = extractGeneratedImages(
    {
      data: [{ b64_json: TRANSPARENT_PNG_BASE64 }],
    },
    "webp"
  )

  assert.equal(images.length, 1)
  assert.ok(images[0]?.src.startsWith("data:image/png;base64,"), images[0]?.src)
}

main()
