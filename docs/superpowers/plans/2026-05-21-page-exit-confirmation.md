# Page Exit Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the browser's native confirmation dialog whenever the user refreshes or closes the page.

**Architecture:** Keep the behavior inside the existing client-side `ImageStudio` component because it already owns browser-only effects. Add a dedicated `beforeunload` effect with cleanup, and lock the behavior with a source-level test that matches the repository's existing test style.

**Tech Stack:** Next.js 16 App Router, React 19 client components, TypeScript, Node `assert`, `tsx`

---

### Task 1: Lock the behavior with a failing test

**Files:**
- Create: `tests/image-studio-exit-confirmation.test.ts`
- Test: `src/components/image-studio.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")

assert.match(
  source,
  /window\.addEventListener\("beforeunload",\s*handleBeforeUnload\)/,
  "image studio should register a beforeunload listener so refresh and close show a confirmation dialog"
)

assert.match(
  source,
  /window\.removeEventListener\("beforeunload",\s*handleBeforeUnload\)/,
  "image studio should remove the beforeunload listener during cleanup"
)

assert.match(
  source,
  /event\.preventDefault\(\)\s*\n\s*event\.returnValue = ""/,
  "beforeunload handler should trigger the browser confirmation requirement"
)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk pnpm exec tsx tests/image-studio-exit-confirmation.test.ts`
Expected: `AssertionError` because the `beforeunload` listener does not exist yet.

### Task 2: Add the minimal client-side implementation

**Files:**
- Modify: `src/components/image-studio.tsx`
- Test: `tests/image-studio-exit-confirmation.test.ts`

- [ ] **Step 1: Write minimal implementation**

```ts
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", handleBeforeUnload)

    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `rtk pnpm exec tsx tests/image-studio-exit-confirmation.test.ts`
Expected: no output, exit code `0`.

Run: `rtk pnpm exec tsx tests/image-studio-elapsed-timer.test.ts`
Expected: no output, exit code `0`.

### Task 3: Final verification

**Files:**
- Test: `tests/image-studio-exit-confirmation.test.ts`
- Test: `tests/image-studio-elapsed-timer.test.ts`

- [ ] **Step 1: Re-run focused verification**

Run: `rtk pnpm exec tsx tests/image-studio-exit-confirmation.test.ts`
Expected: PASS

Run: `rtk pnpm exec tsx tests/image-studio-elapsed-timer.test.ts`
Expected: PASS
