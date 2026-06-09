import OpenAI from "openai"
import { NextResponse } from "next/server"

import { resolveLocale, t } from "@/lib/i18n"
import {
  getConfiguredTrustedImageBaseURLs,
  isTrustedServerImageBaseURL,
  sanitizeEndpointForDisplay,
} from "@/lib/image-endpoint-trust"
import {
  extractGeneratedImages,
  getImageApiError,
  getPayloadField,
  materializeGeneratedImages,
  normalizeImageEndpoint,
  normalizeOpenAIBaseURL,
} from "@/lib/image-request"

export const runtime = "nodejs"
export const maxDuration = 185

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MIN_CUSTOM_DIMENSION = 64
const MAX_CUSTOM_DIMENSION = 8192
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000
const MIN_REQUEST_TIMEOUT_MS = 20
const MAX_REQUEST_TIMEOUT_MS = 600_000
const GENERATE_SIZE_VALUES = new Set([
  "auto",
  "256x256",
  "512x512",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1792x1024",
  "1024x1792",
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840",
])
const EDIT_SIZE_VALUES = new Set([
  "auto",
  "256x256",
  "512x512",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840",
])
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
])

function getText(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key)

  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function getOptionalPayloadText(payload: unknown, key: string) {
  const value = getPayloadField(payload, key)

  return typeof value === "string" && value.trim() ? value.trim() : null
}

function getPayloadKeys(payload: unknown) {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? Object.keys(payload as Record<string, unknown>)
    : []
}

function previewText(value: string, limit = 160) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function getBackground(formData: FormData) {
  const value = getText(formData, "background", "auto")
  return value === "transparent" || value === "opaque" || value === "auto" ? value : "auto"
}

function getOutputFormat(formData: FormData) {
  const value = getText(formData, "outputFormat", "png")
  return value === "jpeg" || value === "webp" || value === "png" ? value : "png"
}

function getGenerateQuality(formData: FormData) {
  const value = getText(formData, "quality", "auto")
  return value === "auto" || value === "low" || value === "medium" || value === "high" || value === "standard" || value === "hd"
    ? value
    : "auto"
}

function normalizeCustomSize(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "").replace(/×/g, "x")
  const match = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/.exec(normalized)

  if (!match) {
    return ""
  }

  const width = Number(match[1])
  const height = Number(match[2])

  if (
    width < MIN_CUSTOM_DIMENSION ||
    width > MAX_CUSTOM_DIMENSION ||
    height < MIN_CUSTOM_DIMENSION ||
    height > MAX_CUSTOM_DIMENSION
  ) {
    return ""
  }

  return `${width}x${height}`
}

function getSize(formData: FormData, supportedSizes: Set<string>) {
  const value = getText(formData, "size", "1024x1024")
  const normalizedCustomSize = normalizeCustomSize(value)

  if (supportedSizes.has(value)) {
    return value
  }

  return normalizedCustomSize || "1024x1024"
}

function getEditQuality(formData: FormData) {
  const value = getText(formData, "quality", "auto")
  return value === "auto" || value === "low" || value === "medium" || value === "high" || value === "standard"
    ? value
    : "auto"
}

function getEditInputFidelity(quality: string) {
  return quality === "high" ? "high" : undefined
}

function getGenerateSize(formData: FormData) {
  return getSize(formData, GENERATE_SIZE_VALUES)
}

function getEditSize(formData: FormData) {
  return getSize(formData, EDIT_SIZE_VALUES)
}

function clampRequestTimeoutMs(value: number) {
  return Math.min(MAX_REQUEST_TIMEOUT_MS, Math.max(MIN_REQUEST_TIMEOUT_MS, Math.round(value)))
}

function getRequestTimeoutMs(formData: FormData) {
  const timeoutMs = Number(getText(formData, "timeoutMs"))

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return clampRequestTimeoutMs(timeoutMs)
  }

  const timeoutSeconds = Number(getText(formData, "timeoutSeconds"))

  if (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) {
    return clampRequestTimeoutMs(timeoutSeconds * 1000)
  }

  return DEFAULT_REQUEST_TIMEOUT_MS
}

export async function POST(request: Request) {
  let locale = resolveLocale(request.headers.get("accept-language"))
  let endpoint = ""
  let requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS

  try {
    const incomingFormData = await request.formData()
    locale = resolveLocale(
      ((): string => {
        const value = incomingFormData.get("locale")
        return typeof value === "string" && value.trim()
          ? value.trim()
          : request.headers.get("accept-language") || ""
      })()
    )
    const userApiKey = getText(incomingFormData, "apiKey")
    const serverApiKey = process.env.OPENAI_API_KEY || ""
    const apiKey = userApiKey || serverApiKey
    const usesServerApiKey = !userApiKey && Boolean(serverApiKey)
    const prompt = getText(incomingFormData, "prompt")

    if (!apiKey) {
      return NextResponse.json({ error: t(locale, "proxyApiKeyRequired") }, { status: 400 })
    }

    if (!prompt) {
      return NextResponse.json({ error: t(locale, "proxyPromptRequired") }, { status: 400 })
    }

    const images = incomingFormData
      .getAll("images")
      .filter((value): value is File => value instanceof File && value.size > 0)

    for (const image of images) {
      if (!SUPPORTED_IMAGE_TYPES.has(image.type)) {
        return NextResponse.json(
          { error: t(locale, "proxyUnsupportedImageFormat", { name: image.name }) },
          { status: 400 }
        )
      }

      if (image.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: t(locale, "proxyImageTooLarge", { name: image.name }) },
          { status: 400 }
        )
      }
    }

    const model = getText(incomingFormData, "model", "gpt-image-2")
    const baseURL = normalizeOpenAIBaseURL(getText(incomingFormData, "endpoint"), locale)

    if (usesServerApiKey && !isTrustedServerImageBaseURL(baseURL, getConfiguredTrustedImageBaseURLs(process.env.OPENAI_TRUSTED_IMAGE_BASE_URLS || "", locale), locale)) {
      return NextResponse.json({ error: t(locale, "proxyServerKeyCustomEndpointBlocked") }, { status: 400 })
    }

    endpoint = normalizeImageEndpoint(getText(incomingFormData, "endpoint"), images.length > 0, locale)
    const displayEndpoint = sanitizeEndpointForDisplay(endpoint)
    const outputFormat = getOutputFormat(incomingFormData)
    const imageCount = Number(getText(incomingFormData, "imageCount", "1"))
    requestTimeoutMs = getRequestTimeoutMs(incomingFormData)
    const background = getBackground(incomingFormData)
    const n = Math.min(Math.max(imageCount, 1), 4)
    const client = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: 0,
    })
    let payload: unknown
    let requestQuality = "auto"
    let requestSize = "1024x1024"
    let requestInputFidelity: string | null = null

    if (images.length) {
      const quality = getEditQuality(incomingFormData)
      const inputFidelity = getEditInputFidelity(quality)
      const size = getEditSize(incomingFormData)

      requestQuality = quality
      requestSize = size
      requestInputFidelity = inputFidelity || null
      payload = await client.images.edit({
        background,
        image: images.length === 1 ? images[0] : images,
        input_fidelity: inputFidelity,
        model,
        n,
        output_format: outputFormat,
        prompt,
        quality,
        size: size as OpenAI.Images.ImageEditParams["size"],
      }, {
        signal: request.signal,
        timeout: requestTimeoutMs,
      })
    } else {
      const quality = getGenerateQuality(incomingFormData)
      const size = getGenerateSize(incomingFormData)

      requestQuality = quality
      requestSize = size
      payload = await client.images.generate({
        background,
        model,
        n,
        output_format: outputFormat,
        prompt,
        quality,
        size: size as OpenAI.Images.ImageGenerateParams["size"],
      }, {
        signal: request.signal,
        timeout: requestTimeoutMs,
      })
    }

    const generatedImages = await materializeGeneratedImages(
      extractGeneratedImages(payload, outputFormat),
      outputFormat
    )
    const reportedQuality = getOptionalPayloadText(payload, "quality")
    const reportedSize = getOptionalPayloadText(payload, "size")

    if (!generatedImages.length) {
      return NextResponse.json(
        {
          endpoint: displayEndpoint,
          error: t(locale, "proxyNoImageField"),
        },
        { status: 502 }
      )
    }

    return NextResponse.json({
      background: getPayloadField(payload, "background"),
      created: getPayloadField(payload, "created"),
      endpoint: displayEndpoint,
      debug: {
        request: {
          background,
          endpoint: displayEndpoint,
          imageCount: n,
          inputFidelity: requestInputFidelity,
          inputImageCount: images.length,
          inputImageNames: images.map((image) => image.name),
          model,
          outputFormat,
          promptPreview: previewText(prompt),
          quality: requestQuality,
          size: requestSize,
          timeoutMs: requestTimeoutMs,
        },
        response: {
          background: getPayloadField(payload, "background"),
          created: getPayloadField(payload, "created"),
          endpoint: displayEndpoint,
          imageCount: generatedImages.length,
          outputFormat: getPayloadField(payload, "output_format") || getPayloadField(payload, "outputFormat") || outputFormat,
          payloadKeys: getPayloadKeys(payload),
          quality: reportedQuality || requestQuality,
          qualityReported: Boolean(reportedQuality),
          size: reportedSize || requestSize,
          sizeReported: Boolean(reportedSize),
          usage: getPayloadField(payload, "usage"),
        },
      },
      images: generatedImages,
      model,
      outputFormat,
      quality: reportedQuality || requestQuality,
      qualityReported: Boolean(reportedQuality),
      size: reportedSize || requestSize,
      sizeReported: Boolean(reportedSize),
      usage: getPayloadField(payload, "usage"),
    })
  } catch (error) {
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return NextResponse.json(
        {
          endpoint: sanitizeEndpointForDisplay(endpoint),
          error: t(locale, "proxyRequestTimeout", { seconds: Math.ceil(requestTimeoutMs / 1000) }),
        },
        { status: 504 }
      )
    }

    if (error instanceof OpenAI.APIUserAbortError) {
      return NextResponse.json(
        {
          endpoint: sanitizeEndpointForDisplay(endpoint),
          error: t(locale, "proxyGenerationFailed"),
        },
        { status: 499 }
      )
    }

    if (error instanceof OpenAI.APIError) {
      return NextResponse.json(
        {
          endpoint: sanitizeEndpointForDisplay(endpoint),
          error: getImageApiError(error.error) || error.message || t(locale, "proxyRequestFailed", { status: error.status || 500 }),
        },
        { status: error.status || 500 }
      )
    }

    return NextResponse.json(
      {
        endpoint: sanitizeEndpointForDisplay(endpoint),
        error: error instanceof Error ? error.message : t(locale, "proxyGenerationFailed"),
      },
      { status: 500 }
    )
  }
}
