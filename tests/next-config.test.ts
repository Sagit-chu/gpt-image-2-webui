import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import type { NextConfig } from "next"
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants"

type NextConfigFactory = (phase: string) => NextConfig | Promise<NextConfig>

const nextConfigPath = resolve(process.cwd(), "next.config.ts")

function assertBaseConfig(nextConfig: NextConfig) {
  assert.equal(nextConfig.experimental?.proxyClientMaxBodySize, "50mb")
}

async function loadNextConfig() {
  const nextConfigUrl = `${pathToFileURL(nextConfigPath).href}?t=${Date.now()}-${Math.random()}`
  const { default: nextConfig } = await import(nextConfigUrl)

  return nextConfig as NextConfig | NextConfigFactory
}

async function resolveNextConfig(phase: string) {
  const nextConfig = await loadNextConfig()

  if (typeof nextConfig === "function") {
    return await nextConfig(phase)
  }

  return nextConfig
}

async function withAllowedOriginsEnv(value: string | undefined, fn: () => Promise<void>) {
  const previousValue = process.env.NEXT_DEV_ALLOWED_ORIGINS

  if (value === undefined) {
    delete process.env.NEXT_DEV_ALLOWED_ORIGINS
  } else {
    process.env.NEXT_DEV_ALLOWED_ORIGINS = value
  }

  try {
    await fn()
  } finally {
    if (previousValue === undefined) {
      delete process.env.NEXT_DEV_ALLOWED_ORIGINS
    } else {
      process.env.NEXT_DEV_ALLOWED_ORIGINS = previousValue
    }
  }
}

async function main() {
  await withAllowedOriginsEnv(undefined, async () => {
    const productionConfig = await resolveNextConfig(PHASE_PRODUCTION_BUILD)
    assertBaseConfig(productionConfig)
    assert.equal(
      Object.hasOwn(productionConfig, "allowedDevOrigins"),
      false,
      "next config should only set allowedDevOrigins in the development server phase",
    )

    const developmentConfig = await resolveNextConfig(PHASE_DEVELOPMENT_SERVER)
    assertBaseConfig(developmentConfig)
    assert.deepEqual(
      developmentConfig.allowedDevOrigins,
      ["127.0.0.1"],
      "next config should only add 127.0.0.1 by default in development",
    )
  })

  await withAllowedOriginsEnv("10.1.5.4, studio.lan, 10.1.5.4,,", async () => {
    const developmentConfig = await resolveNextConfig(PHASE_DEVELOPMENT_SERVER)
    assertBaseConfig(developmentConfig)
    assert.deepEqual(
      developmentConfig.allowedDevOrigins,
      ["127.0.0.1", "10.1.5.4", "studio.lan"],
      "next config should add explicit LAN hosts from NEXT_DEV_ALLOWED_ORIGINS",
    )
  })

  await withAllowedOriginsEnv("devbox:3000", async () => {
    const developmentConfig = await resolveNextConfig(PHASE_DEVELOPMENT_SERVER)
    assertBaseConfig(developmentConfig)
    assert.deepEqual(
      developmentConfig.allowedDevOrigins,
      ["127.0.0.1", "devbox"],
      "next config should normalize single-label hostnames with ports from NEXT_DEV_ALLOWED_ORIGINS",
    )
  })

  await withAllowedOriginsEnv("http://10.1.5.4:3000, https://studio.lan:3000", async () => {
    const developmentConfig = await resolveNextConfig(PHASE_DEVELOPMENT_SERVER)
    assertBaseConfig(developmentConfig)
    assert.deepEqual(
      developmentConfig.allowedDevOrigins,
      ["127.0.0.1", "10.1.5.4", "studio.lan"],
      "next config should normalize URL-style NEXT_DEV_ALLOWED_ORIGINS entries to hostnames",
    )
  })

  await withAllowedOriginsEnv(
    "javascript://evil.lan:3000, ftp://ftp.lan:21, chrome-extension://abc123, https://secure.lan:3000",
    async () => {
      const developmentConfig = await resolveNextConfig(PHASE_DEVELOPMENT_SERVER)
      assertBaseConfig(developmentConfig)
      assert.deepEqual(
        developmentConfig.allowedDevOrigins,
        ["127.0.0.1", "secure.lan"],
        "next config should ignore non-web schemes in NEXT_DEV_ALLOWED_ORIGINS",
      )
    },
  )

  await withAllowedOriginsEnv(
    "mailto:test@example.com, about:blank, javascript:alert(1), https://secure.lan:3000",
    async () => {
      const developmentConfig = await resolveNextConfig(PHASE_DEVELOPMENT_SERVER)
      assertBaseConfig(developmentConfig)
      assert.deepEqual(
        developmentConfig.allowedDevOrigins,
        ["127.0.0.1", "secure.lan"],
        "next config should ignore colon-only non-web schemes in NEXT_DEV_ALLOWED_ORIGINS",
      )
    },
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
