type HasId = {
  id: string
}

export const IMAGE_STUDIO_HISTORY_LIMIT = 6

type ExecuteImageStudioRequestStrategyOptions<TRequestResult, TImage> = {
  total: number
  hasInputImages: boolean
  request: (requestedCount: number) => Promise<TRequestResult>
  selectImages: (result: TRequestResult) => readonly TImage[]
  onRequestResult?: (result: TRequestResult) => void
  onImagesUpdated?: (images: TImage[]) => void
  isControlError?: (error: unknown) => boolean
}

type ExecuteImageStudioRequestStrategyResult<TImage> = {
  images: TImage[]
  firstError: unknown
  isPartial: boolean
}

export function getImageStudioRequestStrategy(total: number, hasInputImages: boolean) {
  const normalizedTotal = Math.min(Math.max(total, 1), 4)

  return {
    requestedCount: hasInputImages ? normalizedTotal : 1,
    useBatchedRequest: hasInputImages,
  }
}

export async function executeImageStudioRequestStrategy<TRequestResult, TImage>({
  total,
  hasInputImages,
  request,
  selectImages,
  onRequestResult,
  onImagesUpdated,
  isControlError,
}: ExecuteImageStudioRequestStrategyOptions<TRequestResult, TImage>): Promise<
  ExecuteImageStudioRequestStrategyResult<TImage>
> {
  const requestStrategy = getImageStudioRequestStrategy(total, hasInputImages)
  const singleRequestCount = getImageStudioRequestStrategy(total, false).requestedCount
  const normalizedTotal = requestStrategy.useBatchedRequest
    ? requestStrategy.requestedCount
    : Math.min(Math.max(total, 1), 4)
  const images: TImage[] = []
  const maxAttempts = normalizedTotal === 1 ? 1 : normalizedTotal + 2
  let attempts = 0
  let firstError: unknown = null

  const pushImages = (nextImages: readonly TImage[]) => {
    if (!nextImages.length || images.length >= normalizedTotal) {
      return
    }

    images.push(...nextImages.slice(0, normalizedTotal - images.length))
    onImagesUpdated?.(images.slice(0, normalizedTotal))
  }

  const runRequest = async (requestedCount: number) => {
    try {
      const result = await request(requestedCount)
      onRequestResult?.(result)
      pushImages(selectImages(result))
    } catch (error) {
      if (isControlError?.(error) === true) {
        throw error
      }

      if (!firstError) {
        firstError = error
      }
    }
  }

  if (requestStrategy.useBatchedRequest) {
    attempts += requestStrategy.requestedCount
    await runRequest(requestStrategy.requestedCount)
  }

  while (images.length < normalizedTotal && attempts < maxAttempts) {
    const batchSize = Math.min(normalizedTotal - images.length, maxAttempts - attempts)
    attempts += batchSize

    await Promise.all(Array.from({ length: batchSize }, () => runRequest(singleRequestCount)))
  }

  return {
    images: images.slice(0, normalizedTotal),
    firstError,
    isPartial: images.length < normalizedTotal,
  }
}

export function appendImageStudioHistory<T extends HasId>(history: readonly T[], next: T, limit = IMAGE_STUDIO_HISTORY_LIMIT) {
  if (history.some((item) => item.id === next.id)) {
    return history as T[]
  }

  return [next, ...history].slice(0, limit)
}
