import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { appendImageStudioHistory } from "../src/lib/image-studio-generation"
import * as generation from "../src/lib/image-studio-generation"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

const sharedHistoryLimit = (generation as Record<string, unknown>).IMAGE_STUDIO_HISTORY_LIMIT

assert.equal(
  typeof sharedHistoryLimit,
  "number",
  "image studio generation helper should export a shared history limit"
)

assert.equal(sharedHistoryLimit, 6, "shared image studio history limit should stay at six items")

const historyLimit = sharedHistoryLimit as number

const history = Array.from({ length: historyLimit }, (_, index) => ({ id: `past-${index + 1}` }))
const next = { id: "newest" }

assert.deepEqual(
  appendImageStudioHistory(history, next),
  [next, ...history.slice(0, historyLimit - 1)],
  "history should keep the newest item first and cap the window at the shared limit"
)

assert.deepEqual(
  appendImageStudioHistory([{ id: "duplicate" }, ...history.slice(0, historyLimit - 1)], { id: "duplicate" }),
  [{ id: "duplicate" }, ...history.slice(0, historyLimit - 1)],
  "history should ignore duplicate ids"
)

assert.match(
  source,
  /import \{[\s\S]*IMAGE_STUDIO_HISTORY_LIMIT[\s\S]*\} from "@\/lib\/image-studio-generation"/,
  "image studio component should import the shared history limit constant"
)

assert.match(
  source,
  /appendImageStudioHistory\(current, result, IMAGE_STUDIO_HISTORY_LIMIT\)/,
  "history appends should use the shared limit constant"
)

assert.doesNotMatch(
  source,
  /const MAX_HISTORY_ITEMS = 6/,
  "image studio component should not keep a duplicate local history limit"
)

const historyThumbnailImage = source.match(/pastResult\.images\.map\(\(image, index\) => \([\s\S]*?<img[\s\S]*?src=\{image\.src\}[\s\S]*?\/>/)

assert.ok(historyThumbnailImage, "history thumbnails should still render a dedicated image element")

assert.match(
  historyThumbnailImage[0],
  /loading="lazy"/,
  "history thumbnails should lazy load to reduce follow-up network pressure"
)

assert.match(
  historyThumbnailImage[0],
  /decoding="async"/,
  "history thumbnails should decode asynchronously"
)

const activeResultImage = source.match(/result\.images\.map\(\(image, index\) => \{[\s\S]*?<img[\s\S]*?src=\{image\.src\}[\s\S]*?\/>/)

assert.ok(activeResultImage, "active result cards should still render an image element")

assert.doesNotMatch(
  activeResultImage[0],
  /loading="lazy"/,
  "active result images should keep their existing loading behavior"
)

assert.doesNotMatch(
  activeResultImage[0],
  /decoding="async"/,
  "active result images should not change decoding behavior in this history-only task"
)
