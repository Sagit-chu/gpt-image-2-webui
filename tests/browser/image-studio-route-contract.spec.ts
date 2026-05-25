import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { once } from "node:events"
import type { AddressInfo } from "node:net"

import { expect, test } from "@playwright/test"

import {
  PNG_BASE64,
  assertNoBrowserErrors,
  attachBrowserErrorCapture,
  expectSettledRequestCount,
  expectSummaryCard,
  openStudio,
  parseMultipartBody,
  parseMultipartRequest,
  selectedResultImage,
  type MultipartSnapshot,
} from "./image-studio-test-helpers"

type UpstreamCall = {
  json: Record<string, unknown> | null
  method: string
  path: string
  request: MultipartSnapshot
}

type MockUpstreamServer = {
  baseURL: string
  calls: UpstreamCall[]
  close: () => Promise<void>
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }

  return Buffer.concat(chunks)
}

function parseJsonBody(body: Buffer) {
  return JSON.parse(body.toString("utf8")) as Record<string, unknown>
}

function createEmptyMultipartSnapshot(): MultipartSnapshot {
  return { fields: {}, files: [] }
}

function createGeneratedPayload(label: string) {
  return {
    created: Date.now(),
    data: [
      {
        b64_json: PNG_BASE64,
        revised_prompt: label,
      },
    ],
  }
}

async function startMockUpstreamServer() {
  const calls: UpstreamCall[] = []
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readRequestBody(request)
    const contentType = Array.isArray(request.headers["content-type"])
      ? request.headers["content-type"][0] || ""
      : request.headers["content-type"] || ""
    const isJson = contentType.includes("application/json")

    calls.push({
      json: isJson ? parseJsonBody(body) : null,
      method: request.method || "GET",
      path: request.url || "/",
      request: isJson ? createEmptyMultipartSnapshot() : parseMultipartBody(contentType, body),
    })

    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify(createGeneratedPayload(`route-contract-${calls.length}`)))
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address() as AddressInfo

  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    calls,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    }),
  } satisfies MockUpstreamServer
}

async function waitForSingleUpstreamCall(server: MockUpstreamServer) {
  await expect.poll(() => server.calls.length).toBe(1)
  return server.calls[0]!
}

test("text-to-image route contract reaches generations and renders the result @cross-browser", async ({ page }) => {
  const errors = attachBrowserErrorCapture(page)
  const upstream = await startMockUpstreamServer()

  try {
    const browserRequests: MultipartSnapshot[] = []

    await page.route("**/api/images", async (route) => {
      browserRequests.push(parseMultipartRequest(route.request()))
      await route.continue()
    })
    await openStudio(page, { endpoint: upstream.baseURL })

    await page.locator("#prompt").fill("Route contract text prompt")
    await page.getByRole("button", { name: /^Generate images/ }).click()

    await expect.poll(() => browserRequests.length).toBe(1)
    const upstreamCall = await waitForSingleUpstreamCall(upstream)

    expect(browserRequests[0]?.fields.prompt).toEqual(["Route contract text prompt"])
    expect(browserRequests[0]?.fields.timeoutMs).toEqual(["90000"])

    expect(upstreamCall.method).toBe("POST")
    expect(upstreamCall.path).toBe("/v1/images/generations")
    expect(upstreamCall.json).toMatchObject({
      n: 1,
      prompt: "Route contract text prompt",
    })
    expect(upstreamCall.request.files).toEqual([])

    await expect(selectedResultImage(page)).toBeVisible()
    await expectSummaryCard(page, "count", "1")
    await expectSettledRequestCount(browserRequests, 1, { label: "browser /api/images request" })
    await expectSettledRequestCount(upstream.calls, 1, { label: "upstream call" })

    assertNoBrowserErrors(errors)
  } finally {
    await upstream.close()
  }
})

test("input-image route contract reaches edits, forwards timeout and files, and renders the result @cross-browser", async ({ page }) => {
  const errors = attachBrowserErrorCapture(page)
  const upstream = await startMockUpstreamServer()

  try {
    const browserRequests: MultipartSnapshot[] = []

    await page.route("**/api/images", async (route) => {
      browserRequests.push(parseMultipartRequest(route.request()))
      await route.continue()
    })
    await openStudio(page, { endpoint: upstream.baseURL })

    await page.locator("#request-timeout").fill("5")
    await page.locator("#prompt").fill("Route contract edit prompt")
    await page.locator('input[type="file"]').setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    })

    await expect(page.getByAltText("reference.png")).toBeVisible()
    await page.getByRole("button", { name: /^Generate images/ }).click()

    await expect.poll(() => browserRequests.length).toBe(1)
    const upstreamCall = await waitForSingleUpstreamCall(upstream)

    expect(browserRequests[0]?.fields.prompt).toEqual(["Route contract edit prompt"])
    expect(browserRequests[0]?.fields.timeoutMs).toEqual(["5000"])
    expect(browserRequests[0]?.files).toEqual([
      {
        contentType: "image/png",
        fieldName: "images",
        filename: "reference.png",
      },
    ])

    expect(upstreamCall.method).toBe("POST")
    expect(upstreamCall.path).toBe("/v1/images/edits")
    expect(upstreamCall.request.fields.n).toEqual(["1"])
    expect(upstreamCall.request.fields.prompt).toEqual(["Route contract edit prompt"])
    expect(upstreamCall.request.files).toEqual([
      {
        contentType: "image/png",
        fieldName: "image",
        filename: "reference.png",
      },
    ])

    await expect(selectedResultImage(page)).toBeVisible()
    await expectSummaryCard(page, "count", "1")
    await expectSummaryCard(page, "input images", "1")
    await expectSettledRequestCount(browserRequests, 1, { label: "browser /api/images request" })
    await expectSettledRequestCount(upstream.calls, 1, { label: "upstream call" })

    assertNoBrowserErrors(errors)
  } finally {
    await upstream.close()
  }
})
