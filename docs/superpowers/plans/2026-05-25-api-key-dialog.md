# API Key Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user submits without an API key, open a dialog that asks only for the API key, supports local persistence, and automatically resumes the blocked generation after confirmation.

**Architecture:** Keep the new flow inside the existing client-side `ImageStudio` component because it already owns submission, persistence, and dialog behavior. Refactor generation into a dedicated `startGeneration()` function, add a second API-key dialog for the missing-key case, and lock the flow with source-level tests that match the repository's current testing style.

**Tech Stack:** Next.js 16 App Router, React 19 client components, TypeScript, shadcn/Base UI alert dialog primitives, Node `assert`, `tsx`

---

### Task 1: Lock the missing-key flow with failing tests

**Files:**
- Create: `tests/image-studio-missing-api-key-dialog.test.ts`
- Modify: `tests/image-studio-remember-key-dialog.test.ts`
- Test: `src/components/image-studio.tsx`

- [ ] **Step 1: Write the failing dialog-flow test**

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /const \[isMissingApiKeyDialogOpen, setIsMissingApiKeyDialogOpen\] = useState\(false\)/,
  "image studio should keep dedicated dialog state for the missing API key flow"
)

assert.match(
  source,
  /const \[pendingGenerationAfterApiKey, setPendingGenerationAfterApiKey\] = useState\(false\)/,
  "image studio should remember that the user already attempted generation before opening the API key dialog"
)

assert.match(
  source,
  /请在 API 密钥页面创建生图专用 key，粘贴在此处，开始使用/,
  "missing-key dialog should explain where to create the image-generation API key"
)

assert.match(
  source,
  /if \(!apiKey\.trim\(\)\) \{\s*setMissingApiKeyValue\(""\)\s*setMissingApiKeyRemember\(rememberKey\)\s*setPendingGenerationAfterApiKey\(true\)\s*setIsMissingApiKeyDialogOpen\(true\)\s*return\s*\}/,
  "submitting without an API key should open the dialog and defer generation"
)

assert.match(
  source,
  /if \(pendingGenerationAfterApiKey\) \{\s*void startGeneration\(\)\s*\}/,
  "confirming the missing-key dialog should automatically continue the blocked generation"
)
```

- [ ] **Step 2: Extend the existing remember-key regression**

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /function promptToRememberApiKey\(\)\s*\{[\s\S]*?if \(!apiKey\.trim\(\) \|\| rememberKey\) \{[\s\S]*?return false[\s\S]*?setIsRememberDialogOpen\(true\)/,
  "remember dialog should still only run for non-empty unsaved API keys"
)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `rtk pnpm exec tsx tests/image-studio-missing-api-key-dialog.test.ts`
Expected: `AssertionError` because the missing-key dialog state and resume flow do not exist yet.

Run: `rtk pnpm exec tsx tests/image-studio-remember-key-dialog.test.ts`
Expected: `AssertionError` if the stricter guard pattern is not implemented yet.

### Task 2: Add localized copy for the new dialog

**Files:**
- Modify: `src/lib/i18n.ts`
- Test: `tests/image-studio-missing-api-key-dialog.test.ts`

- [ ] **Step 1: Add the new message keys**

```ts
  missingApiKeyDialogTitle: "Fill in API key",
  missingApiKeyDialogDescription:
    "请在 API 密钥页面创建生图专用 key，粘贴在此处，开始使用",
  missingApiKeyDialogConfirm: "Confirm and continue",
```

```ts
  missingApiKeyDialogTitle: "填写 API Key",
  missingApiKeyDialogDescription:
    "请在 API 密钥页面创建生图专用 key，粘贴在此处，开始使用",
  missingApiKeyDialogConfirm: "确认并继续",
```

- [ ] **Step 2: Mirror the same keys for the remaining locales**

Set the following values for `zh-TW`, `ja`, `ko`, `es`, `fr`, `de`, and `pt` in this change:

```ts
  missingApiKeyDialogTitle: "Fill in API key",
  missingApiKeyDialogDescription:
    "请在 API 密钥页面创建生图专用 key，粘贴在此处，开始使用",
  missingApiKeyDialogConfirm: "Confirm and continue",
```

- [ ] **Step 3: Run focused test to verify the copy is now present**

Run: `rtk pnpm exec tsx tests/image-studio-missing-api-key-dialog.test.ts`
Expected: it still fails, but no longer on the missing guidance text assertion.

### Task 3: Refactor submission and add the missing-key dialog UI

**Files:**
- Modify: `src/components/image-studio.tsx`
- Test: `tests/image-studio-missing-api-key-dialog.test.ts`
- Test: `tests/image-studio-remember-key-dialog.test.ts`

- [ ] **Step 1: Add dialog and resume state near the existing API-key state**

```ts
  const [isMissingApiKeyDialogOpen, setIsMissingApiKeyDialogOpen] = useState(false)
  const [missingApiKeyValue, setMissingApiKeyValue] = useState("")
  const [missingApiKeyRemember, setMissingApiKeyRemember] = useState(false)
  const [pendingGenerationAfterApiKey, setPendingGenerationAfterApiKey] = useState(false)
```

- [ ] **Step 2: Extract the current generation body into `startGeneration()`**

```ts
  async function startGeneration() {
    if (progressResetTimeoutRef.current) {
      window.clearTimeout(progressResetTimeoutRef.current)
      progressResetTimeoutRef.current = null
    }

    if (!prompt.trim()) {
      toast.error(text.promptRequired)
      return
    }

    if (isCustomSize && !customSizeValue) {
      toast.error(text.customAspectInvalid)
      return
    }

    if (!apiKey.trim()) {
      setMissingApiKeyValue("")
      setMissingApiKeyRemember(rememberKey)
      setPendingGenerationAfterApiKey(true)
      setIsMissingApiKeyDialogOpen(true)
      return
    }

    if (promptToRememberApiKey()) {
      return
    }

    const generationController = new AbortController()

    generationAbortControllerRef.current = generationController
    generationTimeoutRef.current = window.setTimeout(() => {
      generationController.abort(
        createGenerationControlError(
          "GenerationTimeoutError",
          t(locale, "generationTimedOut", { seconds: normalizedRequestTimeoutSeconds })
        )
      )
    }, requestTimeoutMs)

    setIsGenerating(true)
    setGenerationStartedAt(Date.now())
    setElapsedGenerationSeconds(0)
    setProgress(8)
    if (result) {
      setHistory((current) => current.some((item) => item.id === result.id) ? current : [result, ...current])
    }
    setResult(null)
    setSelectedImageIndex(0)

    // keep the existing request loop, partial-result publishing, toast handling,
    // and finally cleanup body immediately below these guards inside startGeneration()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await startGeneration()
  }
```

- [ ] **Step 3: Add confirm/cancel handlers for the new dialog**

```ts
  async function confirmMissingApiKey() {
    const nextApiKey = missingApiKeyValue.trim()

    if (!nextApiKey) {
      toast.error(text.proxyApiKeyRequired)
      return
    }

    setApiKey(nextApiKey)
    setRememberKey(missingApiKeyRemember)
    setIsMissingApiKeyDialogOpen(false)

    if (pendingGenerationAfterApiKey) {
      setPendingGenerationAfterApiKey(false)
      await startGeneration()
    }
  }

  function cancelMissingApiKey() {
    setIsMissingApiKeyDialogOpen(false)
    setPendingGenerationAfterApiKey(false)
  }
```

- [ ] **Step 4: Add the dialog markup next to the existing remember dialog**

```tsx
                <AlertDialog
                  open={isMissingApiKeyDialogOpen}
                  onOpenChange={(open) => {
                    setIsMissingApiKeyDialogOpen(open)
                    if (!open) {
                      setPendingGenerationAfterApiKey(false)
                    }
                  }}
                >
                  <AlertDialogPopup>
                    <AlertDialogTitle>{text.missingApiKeyDialogTitle}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {text.missingApiKeyDialogDescription}
                    </AlertDialogDescription>
                    <div className="mt-4 flex flex-col gap-3">
                      <input
                        autoComplete="off"
                        placeholder="sk-..."
                        type="password"
                        className="studio-control h-11 w-full rounded-md border px-3 py-1 font-mono text-xs"
                        value={missingApiKeyValue}
                        onChange={(event) => setMissingApiKeyValue(event.target.value)}
                      />
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={missingApiKeyRemember}
                          onChange={(event) => setMissingApiKeyRemember(event.target.checked)}
                        />
                        <span>{text.rememberOnDevice}</span>
                      </label>
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      <AlertDialogClose
                        className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium"
                        onClick={cancelMissingApiKey}
                      >
                        {text.rememberDialogCancel}
                      </AlertDialogClose>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
                        onClick={() => void confirmMissingApiKey()}
                      >
                        {text.missingApiKeyDialogConfirm}
                      </button>
                    </div>
                  </AlertDialogPopup>
                </AlertDialog>
```

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `rtk pnpm exec tsx tests/image-studio-missing-api-key-dialog.test.ts`
Expected: no output, exit code `0`.

Run: `rtk pnpm exec tsx tests/image-studio-remember-key-dialog.test.ts`
Expected: no output, exit code `0`.

### Task 4: Regression verification for submission and persistence flows

**Files:**
- Test: `tests/image-studio-stop-timeout-controls.test.ts`
- Test: `tests/image-studio-elapsed-timer.test.ts`
- Test: `tests/image-studio-debug-panel.test.ts`

- [ ] **Step 1: Re-run the related UI source tests**

Run: `rtk pnpm exec tsx tests/image-studio-stop-timeout-controls.test.ts`
Expected: PASS

Run: `rtk pnpm exec tsx tests/image-studio-elapsed-timer.test.ts`
Expected: PASS

Run: `rtk pnpm exec tsx tests/image-studio-debug-panel.test.ts`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `rtk pnpm lint`
Expected: exit code `0`.
