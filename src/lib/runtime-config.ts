export function resolveFixedBaseUrl(value: string | undefined) {
  const normalized = value?.trim()

  if (!normalized) {
    return null
  }

  return normalized.replace(/\/+$/, "")
}
