import assert from "node:assert/strict"

async function main() {
  const originalFetch = globalThis.fetch
  let upstreamCalls = 0

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (url === "https://api.openai.com/v1/images/generations") {
      upstreamCalls += 1
      assert.equal(init?.method, "POST")

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
    formData.append("prompt", "test prompt")
    formData.append("quality", "high")
    formData.append("size", "1536x1024")

    const response = await POST(
      new Request("http://localhost/api/images", {
        body: formData,
        method: "POST",
      })
    )
    const payload = await response.json()

    assert.equal(response.status, 200)
    assert.equal(upstreamCalls, 1)
    assert.equal(payload.quality, "high")
    assert.equal(payload.qualityReported, false)
    assert.equal(payload.size, "1536x1024")
    assert.equal(payload.sizeReported, false)
  } finally {
    globalThis.fetch = originalFetch
  }
}

void main()
