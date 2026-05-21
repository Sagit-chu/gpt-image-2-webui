import { DEFAULT_LOCALE, type Locale, t } from "@/lib/i18n"

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

type UnknownRecord = Record<string, unknown>

export type GeneratedImage = {
  revisedPrompt?: string
  src: string
}

type FetchLike = typeof fetch

export function normalizeOpenAIBaseURL(value: string, locale: Locale = DEFAULT_LOCALE) {
  const rawEndpoint = (value || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, "")

  try {
    const url = new URL(rawEndpoint)
    const pathname = url.pathname.replace(/\/+$/, "")

    if (pathname.endsWith("/images/generations") || pathname.endsWith("/images/edits")) {
      url.pathname = pathname.replace(/\/images\/(?:generations|edits)$/, "")
      return url.toString().replace(/\/+$/, "")
    }

    if (pathname.endsWith("/images")) {
      url.pathname = pathname.replace(/\/images$/, "") || "/"
      return url.toString().replace(/\/+$/, "")
    }

    if (!pathname || pathname === "/") {
      url.pathname = "/v1"
      return url.toString()
    }

    url.pathname = pathname
    return url.toString()
  } catch {
    throw new Error(t(locale, "invalidEndpoint"))
  }
}

export function normalizeImageEndpoint(
  value: string,
  hasInputImages: boolean,
  locale: Locale = DEFAULT_LOCALE
) {
  const operation = hasInputImages ? "edits" : "generations"
  const url = new URL(normalizeOpenAIBaseURL(value, locale))
  const pathname = url.pathname.replace(/\/+$/, "")

  url.pathname = `${pathname}/images/${operation}`

  return url.toString()
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function decodeBase64Bytes(value: string) {
  try {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(value, "base64"))
    }

    if (typeof atob === "function") {
      const decoded = atob(value)
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
    }
  } catch {
    return undefined
  }

  return undefined
}

function inferMimeTypeFromBase64(value: string) {
  const bytes = decodeBase64Bytes(value)

  if (!bytes || bytes.length < 12) {
    return undefined
  }

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png"
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg"
  }

  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp"
  }

  return undefined
}

function toImageSrc(value: unknown, outputFormat: string) {
  const image = asString(value)

  if (!image) {
    return undefined
  }

  if (image.startsWith("data:image/") || image.startsWith("http://") || image.startsWith("https://")) {
    return image
  }

  const mimeType = inferMimeTypeFromBase64(image) || outputFormat

  return `data:image/${mimeType};base64,${image}`
}

function collectImageFromRecord(record: UnknownRecord, outputFormat: string) {
  const src =
    toImageSrc(record.b64_json, outputFormat) ||
    toImageSrc(record.url, outputFormat) ||
    toImageSrc(record.image, outputFormat) ||
    toImageSrc(record.base64, outputFormat) ||
    toImageSrc(record.result, outputFormat)

  if (src) {
    return {
      revisedPrompt: asString(record.revised_prompt) || asString(record.revisedPrompt),
      src,
    } satisfies GeneratedImage
  }

  return undefined
}

function collectFromArray(value: unknown, outputFormat: string) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item): GeneratedImage[] => {
    const src = toImageSrc(item, outputFormat)

    if (src) {
      return [{ src }]
    }

    if (!isRecord(item)) {
      return []
    }

    const image = collectImageFromRecord(item, outputFormat)

    if (image) {
      return [image]
    }

    return [
      ...collectFromArray(item.data, outputFormat),
      ...collectFromArray(item.images, outputFormat),
      ...collectFromArray(item.output, outputFormat),
      ...collectFromArray(item.content, outputFormat),
    ]
  })
}

export function extractGeneratedImages(payload: unknown, outputFormat: string) {
  if (!isRecord(payload)) {
    return []
  }

  const image = collectImageFromRecord(payload, outputFormat)
  const images = [
    ...collectFromArray(payload.data, outputFormat),
    ...collectFromArray(payload.images, outputFormat),
    ...collectFromArray(payload.output, outputFormat),
    ...collectFromArray(payload.content, outputFormat),
  ]

  return image ? [image, ...images] : images
}

export function isContentPolicyViolation(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false
  }

  const error = isRecord(payload.error) ? payload.error : payload
  const code = asString(error.code) || ""

  return (
    code === "content_policy_violation" ||
    code === "auto_suspected_policy_violation"
  )
}

export function getImageApiError(payload: unknown) {
  if (!isRecord(payload)) {
    return undefined
  }

  if (isRecord(payload.error)) {
    return asString(payload.error.message) || asString(payload.error.type)
  }

  return (
    asString(payload.error) ||
    asString(payload.message) ||
    asString(payload.msg) ||
    asString(payload.detail)
  )
}

export function getPayloadField(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return undefined
  }

  return payload[key]
}

function isRemoteImageSrc(value: string) {
  return value.startsWith("http://") || value.startsWith("https://")
}

function encodeBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64")
  }

  let binary = ""

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

async function remoteImageToDataUrl(src: string, outputFormat: string, fetchImpl: FetchLike) {
  const response = await fetchImpl(src)

  if (!response.ok) {
    throw new Error(`Could not download generated image: ${response.status}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  const contentType = response.headers.get("content-type")?.split(";")[0].trim()
  const mimeType = contentType && contentType.startsWith("image/") ? contentType : `image/${outputFormat}`

  return `data:${mimeType};base64,${encodeBase64(bytes)}`
}

export async function materializeGeneratedImages(
  images: GeneratedImage[],
  outputFormat: string,
  fetchImpl: FetchLike = fetch
) {
  return Promise.all(
    images.map(async (image) => ({
      ...image,
      src: isRemoteImageSrc(image.src)
        ? await remoteImageToDataUrl(image.src, outputFormat, fetchImpl)
        : image.src,
    }))
  )
}
