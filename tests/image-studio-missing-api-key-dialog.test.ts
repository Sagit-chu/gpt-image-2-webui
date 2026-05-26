import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /const \[isMissingApiKeyDialogOpen, setIsMissingApiKeyDialogOpen\] = useState\(false\)/,
  "image studio should keep dedicated state for the missing API key dialog"
)

assert.match(
  source,
  /const \[pendingGenerationAfterApiKey, setPendingGenerationAfterApiKey\] = useState\(false\)/,
  "image studio should remember that a generation was blocked by the missing API key dialog"
)

assert.match(
  source,
  /请在 API 密钥页面创建生图专用 key，粘贴在此处，开始使用/,
  "image studio should show the Chinese guidance copy for creating a dedicated image-generation key"
)

assert.match(
  source,
  /if \(!effectiveApiKey\) \{\s*setMissingApiKeyValue\(""\)\s*setMissingApiKeyRemember\(rememberKey\)\s*setPendingGenerationAfterApiKey\(true\)\s*setIsMissingApiKeyDialogOpen\(true\)\s*return\s*\}/,
  "submitting without an API key should open the missing-key dialog and defer generation"
)

assert.match(
  source,
  /setIsMissingApiKeyDialogOpen\(false\)[\s\S]*?setPendingGenerationAfterApiKey\(false\)[\s\S]*?startGeneration\(/,
  "confirming the missing-key dialog should resume the blocked generation"
)

assert.match(
  source,
  /function handleMissingApiKeyDialogConfirm\(\) \{[\s\S]*?if \(!hasLoadedPreferences\) \{\s*rememberKeyEditedBeforeHydrationRef\.current = true\s*apiKeyEditedBeforeHydrationRef\.current = true\s*\}[\s\S]*?setRememberKey\(missingApiKeyRemember\)\s*setApiKey\(nextApiKey\)/,
  "confirming the missing-key dialog before deferred hydration finishes should preserve the freshly entered API key"
)
