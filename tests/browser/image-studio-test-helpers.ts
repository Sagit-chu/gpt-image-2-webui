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

type OpenStudioOptions = {
  apiKey?: string
  endpoint?: string
  remember?: boolean
  waitForHydration?: boolean
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

export async function deferZeroTimeouts(page: Page) {
  await page.addInitScript(() => {
    const originalSetTimeout = window.setTimeout.bind(window)
    const originalClearTimeout = window.clearTimeout.bind(window)
    let nextDeferredTimerId = 1
    const deferredTimers = new Map<number, { args: unknown[]; callback: TimerHandler }>()

    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if ((delay ?? 0) === 0) {
        const deferredTimerId = nextDeferredTimerId
        nextDeferredTimerId += 1
        deferredTimers.set(deferredTimerId, { args, callback })
        return deferredTimerId
      }

      return originalSetTimeout(callback, delay, ...args)
    }) as typeof window.setTimeout

    window.clearTimeout = ((timerId?: number) => {
      if (typeof timerId === "number" && deferredTimers.delete(timerId)) {
        return
      }

      originalClearTimeout(timerId)
    }) as typeof window.clearTimeout

    Object.assign(window, {
      __imgxReleaseDeferredZeroTimeouts() {
        const pendingTimers = [...deferredTimers.values()]
        deferredTimers.clear()
        window.setTimeout = originalSetTimeout
        window.clearTimeout = originalClearTimeout

        for (const { args, callback } of pendingTimers) {
          originalSetTimeout(() => {
            if (typeof callback === "function") {
              callback(...args)
              return
            }

            window.eval(callback)
          }, 0)
        }
      },
    })
  })
}

export async function releaseDeferredZeroTimeouts(page: Page) {
  await page.evaluate(() => {
    ;(window as Window & typeof globalThis & {
      __imgxReleaseDeferredZeroTimeouts?: () => void
    }).__imgxReleaseDeferredZeroTimeouts?.()
  })
}

export async function openStudio(page: Page, options?: OpenStudioOptions) {
  const apiKey = options && "apiKey" in options ? options.apiKey ?? "" : API_KEY
  const endpoint = options && "endpoint" in options ? options.endpoint ?? DEFAULT_OPENAI_BASE_URL : DEFAULT_OPENAI_BASE_URL
  const remember = options?.remember ?? true
  const waitForHydration = options?.waitForHydration ?? true

  await page.context().addCookies([
    {
      name: "imgx.locale",
      value: "en",
      url: "http://127.0.0.1:3000",
    },
  ])

  await page.addInitScript(({ apiKey, endpoint, remember }) => {
    localStorage.setItem("imgx.locale", "en")
    localStorage.setItem(
      "imgx.connectionPreferences",
      JSON.stringify({
        version: 1,
        remember,
        apiKey,
        endpoint,
      })
    )
  }, { apiKey, endpoint, remember })

  await page.goto("/")
  await expect(page.locator("#prompt")).toBeVisible()

  if (waitForHydration) {
    if (!remember) {
      await page.evaluate(() => new Promise<void>((resolve) => {
        window.setTimeout(() => {
          window.setTimeout(resolve, 0)
        }, 0)
      }))
    }

    await expect(page.locator("#api-key")).toHaveValue(apiKey)
  }
}

export function selectedResultImage(page: Page): Locator {
  return page.locator('main button[aria-pressed="true"] img').first()
}

export function generatedResultImages(page: Page): Locator {
  return page.locator('main button[aria-label^="Select image "] img')
}

export function taskRows(page: Page): Locator {
  return page.locator("main [data-task-status]")
}

export function taskRowByPrompt(page: Page, prompt: string): Locator {
  return taskRows(page).filter({ hasText: prompt }).first()
}

export async function expectSummaryCard(page: Page, label: string, value: string) {
  const labelText = page.locator("main").getByText(label, { exact: true }).last()
  const valueText = labelText.locator("xpath=following-sibling::span[1]")

  await expect(labelText).toBeVisible()
  await expect(valueText).toHaveText(value)
}
