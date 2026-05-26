import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const imageStudioSource = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")
const imageRouteSource = readFileSync(join(process.cwd(), "src/app/api/images/route.ts"), "utf8")
const failures: string[] = []

if (!/const DEFAULT_REQUEST_TIMEOUT_SECONDS = 180\b/.test(imageStudioSource)) {
  failures.push("image studio should default the request timeout control to 180 seconds")
}

if (!/const DEFAULT_REQUEST_TIMEOUT_MS = 180_000\b/.test(imageRouteSource)) {
  failures.push("image route should default upstream request timeout to 180000ms")
}

if (!/export const maxDuration = 185\b/.test(imageRouteSource)) {
  failures.push("image route maxDuration should stay narrowly above the 180000ms request timeout")
}

assert.equal(failures.length, 0, failures.join("\n"))
