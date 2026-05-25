import { expect, test } from "@playwright/test"

import {
  PNG_BASE64,
  assertNoBrowserErrors,
  assertNoUnexpectedBrowserErrors,
  attachBrowserErrorCapture,
  expectSettledRequestCount,
  expectSummaryCard,
  generatedResultImages,
  openStudio,
  parseMultipartRequest,
  selectedResultImage,
  type MultipartSnapshot,
} from "./image-studio-test-helpers"

const BASE_URL = "https://api.openai.com/v1"
const GENERATIONS_ENDPOINT = `${BASE_URL}/images/generations`
const EDITS_ENDPOINT = `${BASE_URL}/images/edits`

function createProxyPayload(endpoint: string) {
  return {
    endpoint,
    images: [
      {
        revisedPrompt: "smoke-result",
        src: `data:image/png;base64,${PNG_BASE64}`,
      },
    ],
    quality: "high",
    qualityReported: true,
    size: "1024x1024",
    sizeReported: true,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, reject, resolve }
}

test("request-count stability waits for a quiet period after the last request", async () => {
  const intercepted: MultipartSnapshot[] = [{ fields: {}, files: [] }]
  const lateRequest = setTimeout(() => {
    intercepted.push({ fields: {}, files: [] })
  }, 260)

  try {
    await expect(expectSettledRequestCount(intercepted, 1, { label: "/api/images request" })).rejects.toThrow()
  } finally {
    clearTimeout(lateRequest)
  }
})

test("text-to-image generation succeeds @cross-browser", async ({ page }) => {
  const errors = attachBrowserErrorCapture(page)
  const intercepted: MultipartSnapshot[] = []
  const prompt = "Editorial wristwatch product shot"

  await openStudio(page)

  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)),
    })
  })

  await page.locator("#prompt").fill(prompt)
  await page.getByRole("button", { name: /^Generate images/ }).click()

  await expect.poll(() => intercepted.length).toBe(1)
  expect(intercepted[0]?.fields.prompt).toEqual([prompt])
  expect(intercepted[0]?.fields.imageCount).toEqual(["1"])
  expect(intercepted[0]?.files).toEqual([])

  await expect(selectedResultImage(page)).toBeVisible()
  await expectSummaryCard(page, "count", "1")
  await expectSummaryCard(page, "input images", "0")
  await expectSettledRequestCount(intercepted, 1, { label: "/api/images request" })

  assertNoBrowserErrors(errors)
})

test("input-image generation succeeds @cross-browser", async ({ page }) => {
  const errors = attachBrowserErrorCapture(page)
  const intercepted: MultipartSnapshot[] = []
  const prompt = "Retouch the uploaded bottle product shot"

  await openStudio(page)

  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createProxyPayload(EDITS_ENDPOINT)),
    })
  })

  await page.locator("#prompt").fill(prompt)
  await page.locator('input[type="file"]').setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  })

  await expect(page.getByAltText("reference.png")).toBeVisible()
  await page.getByRole("button", { name: /^Generate images/ }).click()

  await expect.poll(() => intercepted.length).toBe(1)
  expect(intercepted[0]?.fields.prompt).toEqual([prompt])
  expect(intercepted[0]?.fields.imageCount).toEqual(["1"])
  expect(intercepted[0]?.files).toEqual([
    {
      contentType: "image/png",
      fieldName: "images",
      filename: "reference.png",
    },
  ])

  await expect(selectedResultImage(page)).toBeVisible()
  await expectSummaryCard(page, "count", "1")
  await expectSummaryCard(page, "input images", "1")
  await expectSettledRequestCount(intercepted, 1, { label: "/api/images request" })

  assertNoBrowserErrors(errors)
})

test("complete failure shows feedback and no result image @cross-browser", async ({ page }) => {
  const errors = attachBrowserErrorCapture(page)
  const intercepted: MultipartSnapshot[] = []

  await openStudio(page)

  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "mocked total failure" }),
    })
  })

  await page.locator("#prompt").fill("Fail this generation completely")
  await page.getByRole("button", { name: /^Generate images/ }).click()

  await expect.poll(() => intercepted.length).toBe(1)
  await expect(page.getByText("mocked total failure")).toBeVisible()
  await expect(generatedResultImages(page)).toHaveCount(0)
  await expectSettledRequestCount(intercepted, 1, { label: "/api/images request" })

  assertNoUnexpectedBrowserErrors(errors, {
    allowedConsoleErrors: ["Failed to load resource: the server responded with a status of 500 (Internal Server Error)"],
  })
})

test("partial success keeps earlier images visible and shows a warning", async ({ page }) => {
  const errors = attachBrowserErrorCapture(page)
  const intercepted: MultipartSnapshot[] = []
  let requestIndex = 0

  await openStudio(page)

  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    requestIndex += 1

    if (requestIndex === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)),
      })
      return
    }

    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "mocked later failure" }),
    })
  })

  await page.getByRole("button", { name: /^2$/ }).click()
  await page.locator("#prompt").fill("Keep partial results visible")
  await page.getByRole("button", { name: /^Generate images/ }).click()

  await expect(selectedResultImage(page)).toBeVisible()
  await expect(page.getByText(/Generated 1\/2\. Some calls failed:/)).toBeVisible()
  await expectSummaryCard(page, "count", "1 / 2")
  await expect.poll(() => intercepted.length).toBe(4)
  await expectSettledRequestCount(intercepted, 4, { label: "/api/images request" })

  assertNoUnexpectedBrowserErrors(errors, {
    allowedConsoleErrors: ["Failed to load resource: the server responded with a status of 500 (Internal Server Error)"],
  })
})

test("stop while pending shows stopped feedback and prevents extra requests", async ({ page }) => {
  const errors = attachBrowserErrorCapture(page)
  const intercepted: MultipartSnapshot[] = []
  const releasePendingResponse = createDeferred<void>()

  await openStudio(page)

  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    await releasePendingResponse.promise

    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)),
      })
    } catch {
      return
    }
  })

  await page.locator("#prompt").fill("Stop this pending generation")
  await page.getByRole("button", { name: /^Generate images/ }).click()
  await expect.poll(() => intercepted.length).toBe(1)

  await page.getByRole("button", { name: "Stop" }).click()
  await expect(page.getByText("Generation stopped.")).toBeVisible()
  await expectSettledRequestCount(intercepted, 1, { label: "/api/images request" })

  releasePendingResponse.resolve()
  await expect(generatedResultImages(page)).toHaveCount(0)

  assertNoBrowserErrors(errors)
})

test("timeout while pending shows timed-out feedback and no result image", async ({ page }) => {
  const errors = attachBrowserErrorCapture(page)
  const intercepted: MultipartSnapshot[] = []
  const releasePendingResponse = createDeferred<void>()

  await openStudio(page)

  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    await releasePendingResponse.promise

    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)),
      })
    } catch {
      return
    }
  })

  await page.locator("#request-timeout").fill("5")
  await page.locator("#prompt").fill("Timeout this pending generation")
  await page.getByRole("button", { name: /^Generate images/ }).click()
  await expect.poll(() => intercepted.length).toBe(1)

  await expect(page.getByText("Generation timed out after 5s.")).toBeVisible({ timeout: 7_000 })
  await expectSettledRequestCount(intercepted, 1, { label: "/api/images request" })

  releasePendingResponse.resolve()
  await expect(generatedResultImages(page)).toHaveCount(0)

  assertNoBrowserErrors(errors)
})
