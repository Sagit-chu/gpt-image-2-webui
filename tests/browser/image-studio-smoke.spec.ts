import { expect, test } from "@playwright/test"

import {
  DEFAULT_OPENAI_BASE_URL,
  PNG_BASE64,
  assertNoBrowserErrors,
  assertNoUnexpectedBrowserErrors,
  attachBrowserErrorCapture,
  deferZeroTimeouts,
  expectSettledRequestCount,
  expectSummaryCard,
  generatedResultImages,
  openStudio,
  parseMultipartRequest,
  releaseDeferredZeroTimeouts,
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

test("missing API key dialog opens before any proxy request", async ({ page }) => {
  const intercepted: MultipartSnapshot[] = []

  await openStudio(page, { apiKey: "", remember: false })

  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)),
    })
  })

  await page.getByRole("button", { name: /^Generate images/ }).click()

  await expect(page.getByRole("button", { name: "Confirm and continue" })).toBeVisible()
  await expectSettledRequestCount(intercepted, 0, { label: "/api/images request" })
})

test("missing API key dialog cancel closes without submitting the outer form", async ({ page }) => {
  const intercepted: MultipartSnapshot[] = []

  await openStudio(page, { apiKey: "", remember: false })

  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)),
    })
  })

  await page.locator("#prompt").fill("Cancel the missing key dialog")
  await page.getByRole("button", { name: /^Generate images/ }).click()

  const confirmButton = page.getByRole("button", { name: "Confirm and continue" })
  await expect(confirmButton).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()

  await expect(confirmButton).not.toBeVisible()
  await expectSettledRequestCount(intercepted, 0, { label: "/api/images request" })
})

test("remember dialog confirmation resumes generation with the typed connection values", async ({ page }) => {
  const intercepted: MultipartSnapshot[] = []
  const typedApiKey = "sk-unsaved-browser-test"
  const typedEndpoint = "https://typed.example.test/v1"

  await openStudio(page, {
    apiKey: "",
    endpoint: DEFAULT_OPENAI_BASE_URL,
    remember: false,
  })

  await page.route("**/api/images", async (route) => {
    intercepted.push(parseMultipartRequest(route.request()))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createProxyPayload(GENERATIONS_ENDPOINT)),
    })
  })

  await page.locator("#endpoint").fill(typedEndpoint)
  await page.locator("#api-key").fill(typedApiKey)
  await page.getByRole("button", { name: /^Generate images/ }).click()

  await expect(page.getByRole("button", { name: "Yes, remember" })).toBeVisible()
  await page.getByRole("button", { name: "Yes, remember" }).click()

  await expect.poll(() => intercepted.length).toBe(1)
  expect(intercepted[0]?.fields.apiKey).toEqual([typedApiKey])
  expect(intercepted[0]?.fields.endpoint).toEqual([typedEndpoint])
  await expect(selectedResultImage(page)).toBeVisible()
})

test("deferred preference hydration does not overwrite freshly typed connection values", async ({ page }) => {
  const rememberedApiKey = "sk-remembered-browser-test"
  const rememberedEndpoint = "https://remembered.example.test/v1"
  const typedApiKey = "sk-fresh-browser-test"
  const typedEndpoint = "https://typed.example.test/v1"

  await deferZeroTimeouts(page)
  await openStudio(page, {
    apiKey: rememberedApiKey,
    endpoint: rememberedEndpoint,
    remember: true,
    waitForHydration: false,
  })

  await page.locator("#endpoint").fill(typedEndpoint)
  await page.locator("#api-key").fill(typedApiKey)
  await releaseDeferredZeroTimeouts(page)

  let lastConnectionSnapshot = {
    apiKey: typedApiKey,
    endpoint: typedEndpoint,
  }
  let lastConnectionChangeAt = Date.now()

  await expect.poll(async () => {
    const currentSnapshot = await page.evaluate(() => {
      return {
        apiKey: (document.querySelector("#api-key") as HTMLInputElement | null)?.value || "",
        endpoint: (document.querySelector("#endpoint") as HTMLInputElement | null)?.value || "",
      }
    })

    if (
      currentSnapshot.apiKey !== lastConnectionSnapshot.apiKey ||
      currentSnapshot.endpoint !== lastConnectionSnapshot.endpoint
    ) {
      lastConnectionSnapshot = currentSnapshot
      lastConnectionChangeAt = Date.now()
    }

    return (
      currentSnapshot.apiKey === typedApiKey &&
      currentSnapshot.endpoint === typedEndpoint &&
      Date.now() - lastConnectionChangeAt >= 250
    )
  }, {
    message: "freshly typed connection values should survive delayed preference hydration",
    timeout: 1_200,
    intervals: [50, 100, 200],
  }).toBe(true)

  await expect(page.locator("#api-key")).toHaveValue(typedApiKey)
  await expect(page.locator("#endpoint")).toHaveValue(typedEndpoint)
})

test("connection inputs render the same boxed input styling as the API key field @cross-browser", async ({ page }) => {
  await openStudio(page)

  async function getInputBoxStyles(selector: string) {
    return page.locator(selector).evaluate((element) => {
      const styles = window.getComputedStyle(element)

      return {
        borderTopStyle: styles.borderTopStyle,
        borderTopWidth: styles.borderTopWidth,
        borderRadius: styles.borderRadius,
        height: styles.height,
        paddingLeft: styles.paddingLeft,
      }
    })
  }

  const apiKeyStyles = await getInputBoxStyles("#api-key")

  await expect.poll(() => getInputBoxStyles("#endpoint")).toEqual(apiKeyStyles)
  await expect.poll(() => getInputBoxStyles("#request-timeout")).toEqual(apiKeyStyles)
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
