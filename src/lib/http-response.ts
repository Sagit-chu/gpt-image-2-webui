export async function readResponseJson<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || ""

  if (!contentType.includes("application/json")) {
    return null
  }

  return (await response.json()) as T
}
