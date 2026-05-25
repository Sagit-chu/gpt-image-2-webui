import { type Locale } from "@/lib/i18n"
import { executeImageStudioRequestStrategy } from "@/lib/image-studio-generation"
import { type GeneratedImage } from "@/lib/image-request"
import { callImageStudioProxy, type ImageStudioProxyResult } from "@/lib/image-studio-proxy"

export type RunImageStudioSessionOptions<TDebug = unknown> = {
  apiKey: string
  background: string
  endpoint: string
  imageCount: number
  images: readonly File[]
  isControlError?: (error: unknown) => boolean
  locale: Locale
  model: string
  onImagesUpdated?: (images: GeneratedImage[]) => void
  onProxyResult?: (result: ImageStudioProxyResult<TDebug>) => void
  outputFormat: string
  prompt: string
  quality: string
  signal: AbortSignal
  size: string
  timeoutMs: number
}

export type ImageStudioSessionResult<TDebug = unknown> = {
  debug: TDebug | null
  endpoint: string
  firstError: unknown
  images: GeneratedImage[]
  isPartial: boolean
  quality: string
  qualityReported: boolean
  size: string
  sizeReported: boolean
}

export async function runImageStudioSession<TDebug = unknown>(
  options: RunImageStudioSessionOptions<TDebug>
): Promise<ImageStudioSessionResult<TDebug>> {
  let latestDebug: TDebug | null = null
  let latestEndpoint = options.endpoint.trim()
  let latestQuality = options.quality
  let latestQualityReported = false
  let latestSize = options.size
  let latestSizeReported = false

  const requestResult = await executeImageStudioRequestStrategy({
    total: options.imageCount,
    hasInputImages: options.images.length > 0,
    request: async (requestedCount) => {
      const proxyResult = await callImageStudioProxy<TDebug>({
        apiKey: options.apiKey,
        background: options.background,
        endpoint: options.endpoint,
        imageCount: requestedCount,
        images: options.images,
        locale: options.locale,
        model: options.model,
        outputFormat: options.outputFormat,
        prompt: options.prompt,
        quality: options.quality,
        signal: options.signal,
        size: options.size,
        timeoutMs: options.timeoutMs,
      })

      latestDebug = proxyResult.debug || latestDebug
      latestEndpoint = proxyResult.endpoint
      latestQuality = proxyResult.quality || latestQuality
      latestQualityReported = proxyResult.qualityReported
      latestSize = proxyResult.size || latestSize
      latestSizeReported = proxyResult.sizeReported
      options.onProxyResult?.(proxyResult)

      return proxyResult
    },
    selectImages: (proxyResult) => proxyResult.images,
    onImagesUpdated: options.onImagesUpdated,
    isControlError: options.isControlError,
  })

  return {
    debug: latestDebug,
    endpoint: latestEndpoint,
    firstError: requestResult.firstError,
    images: requestResult.images,
    isPartial: requestResult.isPartial,
    quality: latestQuality,
    qualityReported: latestQualityReported,
    size: latestSize,
    sizeReported: latestSizeReported,
  }
}
