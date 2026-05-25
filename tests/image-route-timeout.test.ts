import assert from "node:assert/strict"

async function main() {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (url === "https://api.openai.com/v1/images/generations") {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason || new DOMException("Aborted", "AbortError")),
          { once: true }
        )
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  }

  try {
    const { POST } = await import("../src/app/api/images/route")
    const formData = new FormData()

    formData.append("apiKey", "test-key")
    formData.append("endpoint", "https://api.openai.com/v1")
    formData.append("prompt", "timeout test prompt")
    formData.append("timeoutMs", "20")

    const response = await Promise.race([
      POST(
        new Request("http://localhost/api/images", {
          body: formData,
          method: "POST",
        })
      ),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("route did not time out within 250ms")), 250)
      }),
    ])
    const payload = await response.json()

    assert.equal(response.status, 504)
    assert.match(String(payload.error), /timed out/i)
  } finally {
    globalThis.fetch = originalFetch
  }
}

void main()
