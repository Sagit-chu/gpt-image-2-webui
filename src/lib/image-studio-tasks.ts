import { type Locale } from "@/lib/i18n"
import { sanitizeEndpointForDisplay } from "@/lib/image-endpoint-trust"
import { type GeneratedImage } from "@/lib/image-request"

export type ImageTaskStatus = "queued" | "running" | "completed" | "partial" | "failed" | "stopped" | "timedOut"

export type ImageTaskSnapshot = {
  id: string
  submittedAt: number
  generation: number
  prompt: string
  requestPrompt: string
  references: readonly File[]
  referenceNames: readonly string[]
  model: string
  apiKey: string
  apiKeySet: boolean
  endpoint: string
  outputFormat: string
  background: string
  quality: string
  size: string
  imageCount: number
  timeoutMs: number
  locale: Locale
  sourceLabel?: string
}

export type ImageTask<TDebug = unknown> = {
  snapshot: ImageTaskSnapshot
  status: ImageTaskStatus
  progress: number
  images: GeneratedImage[]
  selectedImageIndex: number
  endpoint: string
  quality: string
  qualityReported: boolean
  size: string
  sizeReported: boolean
  debug: TDebug | null
  errorMessage: string | null
  partialErrorMessage: string | null
  startedAt: number | null
  completedAt: number | null
}

export type CreateImageTaskSnapshotInput = Omit<ImageTaskSnapshot, "apiKeySet" | "prompt" | "referenceNames"> & {
  prompt: string
}

export type SanitizedImageTaskSnapshot = Omit<ImageTaskSnapshot, "apiKey" | "references"> & {
  apiKey: ""
}

export type SanitizedHistoryValue =
  | string
  | number
  | boolean
  | null
  | SanitizedImageTaskSnapshot
  | readonly SanitizedHistoryValue[]
  | { readonly [key: string]: SanitizedHistoryValue | undefined }

type SanitizedDebugValue<TDebug> = TDebug extends unknown ? SanitizedHistoryValue : never

export type ImageTaskHistoryResult<TDebug = unknown> = {
  endpoint: string
  id: string
  generation: number
  debug?: SanitizedDebugValue<TDebug> | null
  images: GeneratedImage[]
  model: string
  outputFormat: string
  prompt: string
  quality: string
  qualityReported: boolean
  requestedCount: number
  size: string
  sizeReported: boolean
  sourceLabel?: string
}

export function clampMaxConcurrentTasks(value: number) {
  return Math.min(4, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)))
}

export function getNextRunnableTaskIds(tasks: readonly ImageTask[], maxConcurrentTasks: number) {
  const capacity = clampMaxConcurrentTasks(maxConcurrentTasks) - tasks.filter((task) => task.status === "running").length

  return capacity <= 0
    ? []
    : tasks
        .filter((task) => task.status === "queued")
        .slice(0, capacity)
        .map((task) => task.snapshot.id)
}

export function isTerminalTaskStatus(status: ImageTaskStatus) {
  return status === "completed" || status === "partial" || status === "failed" || status === "stopped" || status === "timedOut"
}

export function createImageTaskSnapshot(input: CreateImageTaskSnapshotInput): ImageTaskSnapshot {
  const references = [...input.references]

  return {
    ...input,
    apiKeySet: Boolean(input.apiKey.trim()),
    prompt: input.prompt.trim(),
    referenceNames: references.map((file) => file.name),
    references,
  }
}

export function createQueuedImageTask<TDebug = unknown>(snapshot: ImageTaskSnapshot): ImageTask<TDebug> {
  return {
    snapshot,
    status: "queued",
    progress: 0,
    images: [],
    selectedImageIndex: 0,
    endpoint: sanitizeEndpointForDisplay(snapshot.endpoint),
    quality: snapshot.quality,
    qualityReported: false,
    size: snapshot.size,
    sizeReported: false,
    debug: null,
    errorMessage: null,
    partialErrorMessage: null,
    startedAt: null,
    completedAt: null,
  }
}

export function sanitizeImageTaskSnapshot(snapshot: ImageTaskSnapshot): SanitizedImageTaskSnapshot {
  return {
    id: snapshot.id,
    submittedAt: snapshot.submittedAt,
    generation: snapshot.generation,
    prompt: snapshot.prompt,
    requestPrompt: snapshot.requestPrompt,
    referenceNames: snapshot.referenceNames,
    model: snapshot.model,
    apiKey: "",
    apiKeySet: snapshot.apiKeySet,
    endpoint: sanitizeEndpointForDisplay(snapshot.endpoint),
    outputFormat: snapshot.outputFormat,
    background: snapshot.background,
    quality: snapshot.quality,
    size: snapshot.size,
    imageCount: snapshot.imageCount,
    timeoutMs: snapshot.timeoutMs,
    locale: snapshot.locale,
    sourceLabel: snapshot.sourceLabel,
  }
}

function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isImageTaskSnapshot(value: Record<string, unknown>): value is ImageTaskSnapshot {
  return (
    typeof value.id === "string" &&
    typeof value.apiKey === "string" &&
    typeof value.apiKeySet === "boolean" &&
    Array.isArray(value.references) &&
    Array.isArray(value.referenceNames)
  )
}

function redactApiKeyValues(value: string) {
  return value.replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
}

function sanitizeHistoryValue(value: unknown, key?: string): SanitizedHistoryValue | undefined {
  if (isFile(value)) return undefined
  if (value === null) return null

  if (typeof value === "string") {
    const sanitized = redactApiKeyValues(value)
    return key === "endpoint" ? sanitizeEndpointForDisplay(sanitized) : sanitized
  }
  if (typeof value === "number" || typeof value === "boolean") return value

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitized = sanitizeHistoryValue(item)

      return sanitized === undefined ? [] : [sanitized]
    })
  }

  if (!isRecord(value)) return undefined
  if (isImageTaskSnapshot(value)) return sanitizeImageTaskSnapshot(value)

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (key === "apiKey") return [[key, ""]]

      const sanitized = sanitizeHistoryValue(item, key)

      return sanitized === undefined ? [] : [[key, sanitized]]
    })
  )
}

export function updateTaskImages<TDebug>(task: ImageTask<TDebug>, images: GeneratedImage[]): ImageTask<TDebug> {
  const boundedIndex = Math.min(task.selectedImageIndex, Math.max(images.length - 1, 0))

  return { ...task, images, selectedImageIndex: boundedIndex }
}

export function createHistoryResultFromTask<TDebug>(task: ImageTask<TDebug>): ImageTaskHistoryResult<TDebug> | null {
  if (!task.images.length) return null

  const debug = sanitizeHistoryValue(task.debug)

  return {
    endpoint: sanitizeEndpointForDisplay(task.endpoint || task.snapshot.endpoint),
    id: task.snapshot.id,
    generation: task.snapshot.generation,
    debug: debug === undefined ? null : debug,
    images: task.images,
    model: task.snapshot.model,
    outputFormat: task.snapshot.outputFormat,
    prompt: task.snapshot.prompt,
    quality: task.quality,
    qualityReported: task.qualityReported,
    requestedCount: task.snapshot.imageCount,
    size: task.size,
    sizeReported: task.sizeReported,
    sourceLabel: task.snapshot.sourceLabel,
  }
}
