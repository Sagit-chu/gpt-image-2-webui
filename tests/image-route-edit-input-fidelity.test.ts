import assert from "node:assert/strict"

async function main() {
  const originalFetch = globalThis.fetch
  const requests: Array<{ entries: Array<[string, string]>; url: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (url === "data:,") {
      return new Response("", { status: 200 })
    }

    if (url === "https://api.openai.com/v1/images/edits") {
      assert.equal(init?.method, "POST")
      assert.ok(init?.body instanceof FormData)

      requests.push({
        entries: Array.from(init.body.entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name]),
        url,
      })

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
    formData.append("prompt", "edit test prompt")
    formData.append("quality", "high")
    formData.append("size", "1024x1024")
    formData.append("images", new File(["abc"], "reference.png", { type: "image/png" }))

    const response = await POST(
      new Request("http://localhost/api/images", {
        body: formData,
        method: "POST",
      })
    )

    assert.equal(response.status, 200)
    assert.equal(requests.length, 1)
    assert.deepEqual(
      requests[0]?.entries.find(([key]) => key === "input_fidelity"),
      ["input_fidelity", "high"],
      "edit requests with high quality should also request high input fidelity so reference details are preserved"
    )
  } finally {
    globalThis.fetch = originalFetch
  }
}

void main()
