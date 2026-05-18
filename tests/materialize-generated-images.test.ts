import assert from "node:assert/strict"

import { materializeGeneratedImages } from "../src/lib/image-request"

const TRANSPARENT_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c,
  0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
  0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00,
  0x03, 0x03, 0x02, 0x00, 0xef, 0x9b, 0xe6, 0x40,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
])

async function main() {
  let fetchCalls = 0
  const remoteImages = await materializeGeneratedImages(
    [{ revisedPrompt: "keep prompt", src: "https://cdn.example.com/generated.png" }],
    "png",
    async (input) => {
      fetchCalls += 1
      assert.equal(input, "https://cdn.example.com/generated.png")

      return new Response(TRANSPARENT_PNG_BYTES, {
        headers: { "content-type": "image/png" },
        status: 200,
      })
    }
  )

  assert.equal(fetchCalls, 1)
  assert.equal(remoteImages[0]?.revisedPrompt, "keep prompt")
  assert.ok(remoteImages[0]?.src.startsWith("data:image/png;base64,"), remoteImages[0]?.src)

  const inlineImages = await materializeGeneratedImages(
    [{ src: "data:image/png;base64,abc123" }],
    "png",
    async () => {
      throw new Error("should not fetch inline images")
    }
  )

  assert.equal(inlineImages[0]?.src, "data:image/png;base64,abc123")
}

void main()
