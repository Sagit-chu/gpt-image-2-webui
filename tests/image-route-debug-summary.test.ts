import assert from "node:assert/strict"

async function main() {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (url === "https://api.openai.com/v1/images/edits") {
      assert.equal(init?.method, "POST")
      assert.ok(init?.body instanceof FormData)

      return new Response(
        JSON.stringify({
          created: 1,
          data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b5mQAAAAASUVORK5CYII=" }],
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      )
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    const { POST } = await import("../src/app/api/images/route")
    const formData = new FormData()

    formData.append("apiKey", "test-key")
    formData.append("endpoint", "https://api.openai.com/v1")
    formData.append("prompt", "debug test prompt")
    formData.append("quality", "high")
    formData.append("size", "1024x1024")
    formData.append("images", new File(["abc"], "reference.png", { type: "image/png" }))

    const response = await POST(
      new Request("http://localhost/api/images", {
        body: formData,
        method: "POST",
      })
    )
    const payload = await response.json()

    assert.equal(response.status, 200)
    assert.equal(payload.debug.request.endpoint, "https://api.openai.com/v1/images/edits")
    assert.equal(payload.debug.request.inputFidelity, "high")
    assert.equal(payload.debug.request.inputImageCount, 1)
    assert.deepEqual(payload.debug.request.inputImageNames, ["reference.png"])
    assert.equal(payload.debug.request.promptPreview, "debug test prompt")
    assert.deepEqual(payload.debug.response.payloadKeys, ["created", "data"])
    assert.equal(payload.debug.response.quality, "high")
    assert.equal(payload.debug.response.qualityReported, false)
    assert.equal(payload.debug.response.size, "1024x1024")
    assert.equal(payload.debug.response.sizeReported, false)
    assert.equal(payload.debug.response.imageCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
}

void main()
