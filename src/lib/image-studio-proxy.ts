import { readResponseJson } from "@/lib/http-response"
import { type Locale, t } from "@/lib/i18n"
import { type GeneratedImage } from "@/lib/image-request"

type ImageStudioProxyOptions = {
  apiKey: string
  background: string
  endpoint: string
  imageCount: number
  images: readonly File[]
  locale: Locale
  model: string
  outputFormat: string
  prompt: string
  quality: string
  signal?: AbortSignal
  size: string
  timeoutMs: number
}

type ImageStudioProxyPayload<TDebug> = {
  endpoint?: string
  debug?: TDebug
  error?: string
  images?: GeneratedImage[]
  quality?: string
  qualityReported?: boolean
  size?: string
  sizeReported?: boolean
}

export type ImageStudioProxyResult<TDebug = unknown> = {
  endpoint: string
  debug: TDebug | null
  images: GeneratedImage[]
  quality: string | null
  qualityReported: boolean
  size: string | null
  sizeReported: boolean
}

export async function callImageStudioProxy<TDebug = unknown>(options: ImageStudioProxyOptions): Promise<
  ImageStudioProxyResult<TDebug>
> {
  const formData = new FormData()

  formData.append("apiKey", options.apiKey.trim())
  formData.append("background", options.background)
  formData.append("endpoint", options.endpoint.trim())
  formData.append("imageCount", String(options.imageCount))
  formData.append("locale", options.locale)
  formData.append("model", options.model)
  formData.append("outputFormat", options.outputFormat)
  formData.append("prompt", options.prompt)
  formData.append("quality", options.quality)
  formData.append("size", options.size)
  formData.append("timeoutMs", String(options.timeoutMs))

  for (const image of options.images) {
    formData.append("images", image, image.name)
  }

  const response = await fetch("/api/images", {
    method: "POST",
    body: formData,
    signal: options.signal,
  })
  const payload = await readResponseJson<ImageStudioProxyPayload<TDebug>>(response)

  if (!response.ok) {
    throw new Error(
      payload?.error ||
      t(options.locale, "requestFailedStatus", { status: response.status })
    )
  }

  if (!payload?.images?.length) {
    throw new Error(t(options.locale, "noImageInPayload"))
  }

  return {
    endpoint: payload.endpoint || options.endpoint,
    debug: payload.debug || null,
    images: payload.images,
    quality: payload.quality?.trim() || null,
    qualityReported: payload.qualityReported === true,
    size: payload.size?.trim() || null,
    sizeReported: payload.sizeReported === true,
  }
}
