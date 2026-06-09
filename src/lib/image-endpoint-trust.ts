import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n"
import { DEFAULT_OPENAI_BASE_URL, normalizeOpenAIBaseURL } from "@/lib/image-request"

export const TRUSTED_IMAGE_BASE_URLS_ENV = "OPENAI_TRUSTED_IMAGE_BASE_URLS"

export function getConfiguredTrustedImageBaseURLs(value = process.env[TRUSTED_IMAGE_BASE_URLS_ENV] || "", locale: Locale = DEFAULT_LOCALE) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeOpenAIBaseURL(item, locale))
}

export function isTrustedServerImageBaseURL(baseURL: string, trustedBaseURLs: readonly string[] = [], locale: Locale = DEFAULT_LOCALE) {
  const normalizedBaseURL = normalizeOpenAIBaseURL(baseURL, locale)
  const defaultBaseURL = normalizeOpenAIBaseURL(DEFAULT_OPENAI_BASE_URL, locale)
  return normalizedBaseURL === defaultBaseURL || trustedBaseURLs.some((trustedBaseURL) => normalizedBaseURL === normalizeOpenAIBaseURL(trustedBaseURL, locale))
}

export function sanitizeEndpointForDisplay(value: string) {
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    return url.toString()
  } catch {
    return value
  }
}
