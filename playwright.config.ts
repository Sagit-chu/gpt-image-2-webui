import { defineConfig } from "@playwright/test"

const PORT = 3000
const HOST = "127.0.0.1"
const baseURL = `http://${HOST}:${PORT}`

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    locale: "en-US",
    trace: "on-first-retry",
    viewport: {
      width: 1440,
      height: 960,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
    {
      name: "firefox",
      grep: /@cross-browser/,
      use: {
        browserName: "firefox",
      },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --webpack --hostname ${HOST} --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
