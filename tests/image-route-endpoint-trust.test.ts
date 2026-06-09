import assert from "node:assert/strict"

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b5mQAAAAASUVORK5CYII="

function getAuthorizationHeader(headers: HeadersInit | undefined) {
  if (!headers) return ""
  if (headers instanceof Headers) return headers.get("authorization") || ""
  if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === "authorization")?.[1] || ""
  return Object.entries(headers).find(([key]) => key.toLowerCase() === "authorization")?.[1] || ""
}

async function postImage(formData: FormData) {
  const { POST } = await import("../src/app/api/images/route")
  return POST(new Request("http://localhost/api/images", { body: formData, method: "POST" }))
}

function createFormData(endpoint: string, apiKey = "") {
  const formData = new FormData()
  if (apiKey) formData.append("apiKey", apiKey)
  formData.append("endpoint", endpoint)
  formData.append("prompt", "endpoint trust prompt")
  return formData
}

async function main() {
  const originalFetch = globalThis.fetch
  const originalServerKey = process.env.OPENAI_API_KEY
  const originalTrusted = process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS
  const upstreamCalls: Array<{ authorization: string; url: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    upstreamCalls.push({ authorization: getAuthorizationHeader(init?.headers), url })
    return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })
  }

  try {
    process.env.OPENAI_API_KEY = "sk-server-key"
    delete process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS

    const defaultResponse = await postImage(createFormData("https://api.openai.com/v1"))
    assert.equal(defaultResponse.status, 200)
    assert.equal(upstreamCalls.at(-1)?.url, "https://api.openai.com/v1/images/generations")
    assert.equal(upstreamCalls.at(-1)?.authorization, "Bearer sk-server-key")

    const rejected = await postImage(createFormData("https://untrusted.example.test/v1"))
    const rejectedPayload = await rejected.json()
    assert.equal(rejected.status, 400)
    assert.match(String(rejectedPayload.error), /custom endpoint/i)
    assert.equal(upstreamCalls.length, 1, "untrusted custom endpoint must not receive the server key")

    const userKeyResponse = await postImage(createFormData("https://untrusted.example.test/v1", "sk-user-key"))
    assert.equal(userKeyResponse.status, 200)
    assert.equal(upstreamCalls.at(-1)?.url, "https://untrusted.example.test/v1/images/generations")
    assert.equal(upstreamCalls.at(-1)?.authorization, "Bearer sk-user-key")

    const credentialEndpointResponse = await postImage(createFormData("https://user:pass@credential.example.test/v1", "sk-user-key"))
    const credentialEndpointPayload = await credentialEndpointResponse.json()
    assert.equal(credentialEndpointResponse.status, 200)
    assert.equal(upstreamCalls.at(-1)?.url, "https://user:pass@credential.example.test/v1/images/generations")
    assert.equal(credentialEndpointPayload.endpoint, "https://credential.example.test/v1/images/generations")
    assert.equal(credentialEndpointPayload.debug.request.endpoint, "https://credential.example.test/v1/images/generations")
    assert.equal(credentialEndpointPayload.debug.response.endpoint, "https://credential.example.test/v1/images/generations")

    process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS = "https://trusted.example.test/v1"
    const trustedResponse = await postImage(createFormData("https://trusted.example.test/v1"))
    assert.equal(trustedResponse.status, 200)
    assert.equal(upstreamCalls.at(-1)?.url, "https://trusted.example.test/v1/images/generations")
    assert.equal(upstreamCalls.at(-1)?.authorization, "Bearer sk-server-key")
  } finally {
    globalThis.fetch = originalFetch
    if (originalServerKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalServerKey
    if (originalTrusted === undefined) delete process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS
    else process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS = originalTrusted
  }
}

void main()
