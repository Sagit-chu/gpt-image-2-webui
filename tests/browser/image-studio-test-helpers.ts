import { expect, type Locator, type Page, type Request } from "@playwright/test"

export const API_KEY = "sk-browser-test"
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
export const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="

export type MultipartSnapshot = {
  fields: Record<string, string[]>
  files: Array<{
    contentType: string
    fieldName: string
    filename: string
  }>
}

type BrowserErrors = {
  consoleErrors: string[]
  pageErrors: string[]
}

type SettledCountTarget = {
  length: number
}

export function attachBrowserErrorCapture(page: Page): BrowserErrors {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text())
    }
  })

  page.on("pageerror", (error) => {
    pageErrors.push(error.message)
  })

  return { consoleErrors, pageErrors }
}

export function assertNoBrowserErrors(errors: BrowserErrors) {
  assertNoUnexpectedBrowserErrors(errors)
}

export function assertNoUnexpectedBrowserErrors(errors: BrowserErrors, options?: { allowedConsoleErrors?: string[] }) {
  const unexpectedConsoleErrors = errors.consoleErrors.filter((message) => !options?.allowedConsoleErrors?.some(
    (allowedMessage) => message.includes(allowedMessage)
  ))

  expect(errors.pageErrors, errors.pageErrors.join("\n")).toEqual([])
  expect(unexpectedConsoleErrors, unexpectedConsoleErrors.join("\n")).toEqual([])
}

export async function expectSettledRequestCount(target: SettledCountTarget, count: number, options?: { label?: string }) {
  const quietPeriodMs = 350

  expect(target).toHaveLength(count)

  let lastObservedCount = target.length
  let lastCountChangeAt = Date.now()

  await expect.poll(() => {
    const currentCount = target.length
    const now = Date.now()

    if (currentCount !== lastObservedCount) {
      lastObservedCount = currentCount
      lastCountChangeAt = now
    }

    return currentCount === count && now - lastCountChangeAt >= quietPeriodMs
  }, {
    message: `expected ${options?.label || "request"} count to remain at ${count} after the UI settled`,
    timeout: 1_000,
    intervals: [50, 100, 200],
  }).toBe(true)
}

export function parseMultipartBody(contentType: string, body: Buffer): MultipartSnapshot {
  const boundaryMatch = /boundary=([^;]+)/i.exec(contentType)

  if (!boundaryMatch) {
    throw new Error(`missing multipart boundary: ${contentType}`)
  }

  const boundary = `--${boundaryMatch[1]}`
  const parts = body.toString("latin1").split(boundary).slice(1, -1)
  const fields: Record<string, string[]> = {}
  const files: MultipartSnapshot["files"] = []

  for (const part of parts) {
    const normalizedPart = part.replace(/^\r\n/, "").replace(/\r\n$/, "")
    const separatorIndex = normalizedPart.indexOf("\r\n\r\n")

    if (separatorIndex === -1) {
      continue
    }

    const rawHeaders = normalizedPart.slice(0, separatorIndex)
    const rawValue = normalizedPart.slice(separatorIndex + 4).replace(/\r\n$/, "")
    const dispositionMatch = /name="([^"]+)"(?:; filename="([^"]+)")?/i.exec(rawHeaders)

    if (!dispositionMatch) {
      continue
    }

    const fieldName = dispositionMatch[1]
    const filename = dispositionMatch[2]

    if (filename) {
      const fileContentType = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1] || ""
      files.push({ contentType: fileContentType, fieldName, filename })
      continue
    }

    fields[fieldName] = [...(fields[fieldName] || []), rawValue]
  }

  return { fields, files }
}

export function parseMultipartRequest(request: Request): MultipartSnapshot {
  const contentType = request.headers()["content-type"] || ""
  const body = request.postDataBuffer()

  if (!body) {
    throw new Error("missing multipart request body")
  }

  return parseMultipartBody(contentType, body)
}

export async function openStudio(page: Page, options?: { apiKey?: string; endpoint?: string }) {
  const apiKey = options?.apiKey || API_KEY
  const endpoint = options?.endpoint || DEFAULT_OPENAI_BASE_URL

  await page.context().addCookies([
    {
      name: "imgx.locale",
      value: "en",
      url: "http://127.0.0.1:3000",
    },
  ])

  await page.addInitScript(({ apiKey, endpoint }) => {
    localStorage.setItem("imgx.locale", "en")
    localStorage.setItem(
      "imgx.connectionPreferences",
      JSON.stringify({
        version: 1,
        remember: true,
        apiKey,
        endpoint,
      })
    )
  }, { apiKey, endpoint })

  await page.goto("/")
  await expect(page.locator("#prompt")).toBeVisible()
  await expect(page.locator("#api-key")).toHaveValue(apiKey)
}

export function selectedResultImage(page: Page): Locator {
  return page.locator('main button[aria-pressed="true"] img').first()
}

export function generatedResultImages(page: Page): Locator {
  return page.locator('main button[aria-label^="Select image "] img')
}

export async function expectSummaryCard(page: Page, label: string, value: string) {
  const labelText = page.locator("main").getByText(label, { exact: true }).last()
  const valueText = labelText.locator("xpath=following-sibling::span[1]")

  await expect(labelText).toBeVisible()
  await expect(valueText).toHaveText(value)
}
