# Image Generation Runtime And Browser Coverage Design

## Goal

Close the remaining confidence gap around image generation by adding one lightweight component-runtime test seam plus two minimal browser layers: one mocked `/api/images` smoke layer for UI behavior and one real route-contract browser spec that drives the real `/api/images` route against a local mock upstream server. Keep the suite intentionally small: Chromium runs the full browser matrix, Firefox runs only a stable happy-path plus complete-failure subset, and the repository still keeps its existing `tsx`-first test style instead of turning into a broad end-to-end suite.

## Approved Scope

- Add a small runtime-oriented helper seam for `ImageStudio` generation session orchestration so tests can cover component-side request wiring more directly.
- Keep the existing helper, route, and local integration tests as the lower-layer coverage.
- Add one minimal mocked browser smoke suite for six targeted browser cases:
  - text-to-image generation succeeds
  - input-image generation succeeds
  - complete failure feedback is shown
  - partial success with a later failure keeps earlier results visible
  - user stop while the request is still pending
  - timeout while the request is still pending
- Add one separate real route-contract browser spec that uses a real browser, the real front-end, the real `/api/images` route, and a test-local mock upstream server.
- In that route-contract spec, verify:
  - text-to-image calls reach `/v1/images/generations`
  - input-image calls reach `/v1/images/edits`
  - the upstream request still carries meaningful forwarded data such as `n`, `prompt`, uploaded image file part(s), and any timeout-related field the route currently forwards in multipart form data
- Extend Playwright coverage from Chromium-only to Chromium plus Firefox.
- Chromium runs the full browser suite.
- Firefox runs only the stable browser subset: happy paths plus complete failure.
- Keep the deeper unhappy-path cases Chromium-only for now:
  - partial success with a later failure
  - user stop while pending
  - timeout while pending
- Keep the unhappy-path extension browser-only; do not broaden route/helper lower-layer coverage for it.
- Prefer test-only changes unless either browser layer reveals a real production bug.
- Keep the new browser coverage intentionally small and focused on real page interaction, upload flow, route-contract correctness, pending-state controls, and rendered feedback/results.
- Keep browser assertions minimal and behavior-oriented.

## Non-Goals

- No large Playwright migration of the current `tests/*.test.ts` suite.
- No visual regression snapshots.
- No real external upstream API calls in browser tests; only a test-local mock upstream server.
- No broad lower-layer route/helper/runtime expansion just to cover the four new browser unhappy paths.
- No broad refactor of `ImageStudio` beyond the smallest seam needed for runtime coverage.
- No replacement of the existing route/helper integration tests.
- No Firefox parity yet for the Chromium-only unhappy-path cases.

## Current Code Constraints

- The project currently uses lightweight standalone `tsx` tests with `node:assert/strict`.
- There is no existing browser test framework in `package.json`.
- `ImageStudio` still owns most request/session/UI orchestration, even after `image-studio-generation.ts` and `image-studio-proxy.ts` were introduced.
- Lower-layer confidence is already decent:
  - request strategy is behavior-tested in `tests/image-studio-adaptive-request-strategy.test.ts`
  - real proxy glue plus real route plus mocked upstream is covered in `tests/image-route-request-strategy-integration.test.ts`
- Remaining confidence gap is mainly at three edges:
  - component-side runtime wiring around a generation session
  - real browser interaction through the page DOM
  - real browser proof that page state still drives the correct `/api/images` route behavior and upstream request shape

## Root Cause Summary

1. Existing tests prove the strategy helper and proxy/route chain, but not enough of the component-side orchestration boundary.
2. Existing tests do not exercise a real browser session with prompt entry, upload interaction, button click, and rendered results.
3. Existing lower-layer route tests do not confirm the same contract under a real browser session that travels through page state, `/api/images`, and the upstream client request.
4. Adding only more lower-layer tests would keep missing the exact user-facing interaction surface we still care about.

## Approaches Considered

### 1. Add only more lightweight `tsx` tests

Rejected.

- Lowest cost, but it still leaves a browser/DOM confidence gap.

### 2. Add only browser-level smoke coverage

Rejected.

- Better user-path coverage, but it would leave the component-side orchestration too dependent on source-level checks and broad browser assertions.

### 3. Add one small runtime seam plus one mocked browser smoke spec and one real route-contract browser spec

Recommended.

- Keeps the existing lightweight stack for most of the codebase.
- Adds the smallest possible seam to test component-side generation orchestration behavior directly.
- Adds only two tiny browser specs: one mocked smoke layer for DOM-focused behavior and one real route-contract layer for endpoint/forwarding coverage.
- Extends browser confidence to Firefox without forcing full unhappy-path parity there.
- Avoids making browser tests responsible for lower-layer logic we already cover elsewhere.

## Recommended Architecture

Split the new coverage into two deliberately small areas: one runtime seam and one browser layer composed of two narrow spec files.

### Layer 1: Component Runtime Coverage

Introduce one small helper under `src/lib/` dedicated to a generation-session runtime seam.

- `ImageStudio` should continue owning:
  - prompt construction
  - locale/text lookup
  - React state updates
  - timeout scheduling and `AbortController` lifecycle
  - toast selection and UI rendering
- The new seam should own only the narrow runtime orchestration that is currently awkward to test from the component:
  - invoking the shared proxy helper through the request strategy
  - surfacing incremental image updates and final completion shape through callbacks
  - keeping the text-only and input-image paths on the already-shipped behavior

This seam should stay much smaller than `ImageStudio` itself and should not become a second UI controller.

### Layer 2: Browser Coverage

Add a very small browser test setup.

- Use Playwright as the browser runner because the project currently has no browser testing stack.
- Keep it to two browser spec files.
- Keep one mocked `/api/images` smoke spec so the UI-focused browser cases validate page behavior without network dependency noise.
- Add one separate real route-contract spec so browser coverage also proves the page still drives the correct `/api/images` and upstream request contract.
- The mocked smoke spec should verify only:
  - entering a prompt and generating one mocked result
  - uploading one image, generating one mocked result, and showing the expected summary/result UI
  - surfacing failure feedback after a complete mocked `/api/images` failure with no generated result image
  - keeping earlier generated image(s) visible when a later mocked request fails
  - surfacing stopped feedback when the user clicks `Stop` during a pending mocked request
  - surfacing timed-out feedback when a pending mocked request exceeds the configured timeout
- The real route-contract spec should verify only:
  - text-to-image uses the real `/api/images` route and reaches `/v1/images/generations`
  - input-image uses the real `/api/images` route and reaches `/v1/images/edits`
  - the local mock upstream receives the expected forwarded request data, especially `n`, `prompt`, and image file part(s)

This keeps browser tests fast, deterministic, and focused on the missing interaction and route-contract layers.

## Runtime Seam Design

### Responsibilities

The runtime seam should accept already-prepared inputs from `ImageStudio` and expose a narrow callback-based execution model.

Expected responsibilities:

- call the existing request-strategy helper
- use the existing shared proxy helper for network work
- emit partial image updates through a callback
- return final completion metadata needed by the component

Expected non-responsibilities:

- no JSX
- no direct toast calls
- no direct access to React hooks/state
- no locale string lookup

### Testing Intent

Runtime tests should prove component-adjacent behavior that current tests do not lock strongly enough, especially the text-only path and session-level wiring.

The new runtime tests should cover:

- text-only generation calls into the shared proxy helper with repeated single-image requests
- input-image generation calls into the shared proxy helper with the existing batch-first behavior
- timeout/abort-style control errors still propagate through the runtime seam without being converted into ordinary fallback behavior

## Browser Coverage Design

### Framework

Add Playwright as a minimal dev dependency plus the smallest supporting config/scripts needed to run local browser tests in Chromium and Firefox.

### Test Strategy

Use two minimal browser strategies.

- `tests/browser/image-studio-smoke.spec.ts` should intercept `/api/images` locally.
- `tests/browser/image-studio-route-contract.spec.ts` should call the real `/api/images` route and point the app at a test-local mock upstream server.
- Do not call real external upstream APIs.
- Return deterministic upstream payloads shaped like the current OpenAI image response contract.

### Cross-Browser Scope

- Chromium runs the full browser suite:
  - all six mocked smoke scenarios
  - both real route-contract happy-path scenarios
- Firefox runs only the stable browser subset:
  - mocked text-to-image success
  - mocked input-image success
  - mocked complete failure
  - real route-contract text-to-image success
  - real route-contract input-image success
- Keep partial-success, stop, and timeout browser coverage Chromium-only for now.

### Scenarios

#### 1. Text-to-Image Smoke

- open the app
- fill the prompt field
- click generate
- intercept `/api/images` and return one image result
- assert the result image appears and summary fields update consistently

#### 2. Input-Image Smoke

- open the app
- upload one image file
- fill or keep a prompt
- click generate
- intercept `/api/images` and return one image result
- assert the result image appears and the summary/reference UI reflects the uploaded input path

#### 3. Complete Failure Smoke

- open the app
- fill the prompt field
- click generate
- intercept one `/api/images` request and return a deterministic failure
- assert failure feedback becomes visible
- assert no generated result image appears
- assert the final intercepted request count stays at one

#### 4. Partial Success With Later Failure Smoke

- open the app
- set image count above `1`
- fill the prompt field
- let an earlier intercepted `/api/images` request succeed, then fail a later one
- assert the earlier generated image remains visible
- assert the partial warning becomes visible
- assert the final intercepted request count stabilizes once the failure path is complete

#### 5. User Stop While Pending Smoke

- open the app
- fill the prompt field
- intercept `/api/images` with a deferred/pending response
- click generate, then click `Stop` before the mocked response resolves
- assert stopped feedback becomes visible
- assert the intercepted request count stops growing
- assert no unexpected generated result appears after stopping

#### 6. Timeout While Pending Smoke

- open the app
- set the timeout control to its minimum value
- fill the prompt field
- intercept `/api/images` with a deferred/pending response that outlives the timeout
- click generate
- assert timed-out feedback becomes visible
- assert no unexpected generated result appears after timeout
- assert the intercepted request count stabilizes after the timeout aborts the session

#### 7. Real Route-Contract Text-to-Image

- open the app with the endpoint pointed at the local mock upstream server
- fill the prompt field
- click generate
- allow the real `/api/images` route to forward the request to the local mock upstream server
- assert the upstream request path is `/v1/images/generations`
- assert the upstream request includes `n`, `prompt`, and no uploaded image file parts
- assert the returned result image still renders in the page

#### 8. Real Route-Contract Input-Image

- open the app with the endpoint pointed at the local mock upstream server
- upload one image file
- fill or keep a prompt
- click generate
- allow the real `/api/images` route to forward the request to the local mock upstream server
- assert the upstream request path is `/v1/images/edits`
- assert the upstream request includes `n`, `prompt`, uploaded image file part(s), and any timeout-related form field if the route forwards one today
- assert the returned result image still renders in the page

### Out of Scope For Browser Coverage

- multi-language browser assertions
- browser retry/error coverage beyond the four approved Chromium unhappy-path scenarios
- Firefox parity for the Chromium-only unhappy-path scenarios
- history performance assertions in the browser
- exact CSS or screenshot diffing
- lower-layer route/helper/runtime coverage expansion for the browser unhappy-path extension
- additional real route-contract browser cases beyond the two approved happy paths

## Error Handling

- The runtime seam must preserve the current control-error behavior and ordinary-error distinction.
- Browser smoke tests should fail fast on console/page errors when those errors are caused by the tested interaction path.
- Mocked `/api/images` responses in browser tests should stay small and deterministic.
- Pending-response smoke tests should keep assertions minimal: request-count stability, visible feedback, retained images, and the absence of unexpected results.
- The real route-contract browser spec should fail fast on unexpected upstream path selection or missing forwarded `n`/`prompt`/file data.
- If the route-contract browser spec exposes a real `/api/images` production bug, the smallest production fix is in scope; otherwise keep the work test-only.

## Testing Plan

### New Runtime Coverage

- Add a new `tsx` test file for the runtime seam.
- Keep assertions behavior-oriented and small.
- Re-run the already related request-strategy, proxy-route integration, and timeout/control tests.

### New Browser Coverage

- Add one mocked Playwright smoke spec and one real route-contract Playwright spec.
- Add the minimum config and npm scripts needed to run both specs locally and in CI later across Chromium and Firefox.
- Reuse a tiny in-test fixture image for upload instead of adding a large asset.
- Extend the mocked `/api/images` smoke spec with the four approved unhappy-path browser scenarios.
- Keep the unhappy-path extension browser-only and Chromium-only beyond the complete-failure case.
- Run Chromium on the full browser suite and Firefox on only the stable subset.
- Spin up a tiny local mock upstream server inside the route-contract spec instead of hitting the real OpenAI service.
- Prefer test-only changes unless the route-contract browser spec reveals a verified production bug.

## Risks

- If the runtime seam grows too large, it will become a shadow controller and increase maintenance cost.
- If browser smoke covers too many concerns at once, failures will become noisy and slow to debug.
- If mocked `/api/images` payloads drift from the real contract, the smoke suite will become falsely reassuring.
- If the local mock upstream server or multipart assertions drift from the SDK's real request shape, the route-contract spec could become brittle or misleading.
- If Firefox is forced to mirror every Chromium unhappy path too early, browser maintenance cost will rise faster than the added confidence.
- If the browser test stack is added too broadly, this project will pay a large maintenance cost for little additional value.

## Files Expected To Change

- `src/lib/image-studio-session.ts`
- `src/components/image-studio.tsx`
- `tests/image-studio-session.test.ts`
- `package.json`
- `playwright.config.ts`
- `tests/browser/image-studio-smoke.spec.ts`
- `tests/browser/image-studio-route-contract.spec.ts`
- `docs/superpowers/specs/2026-05-25-image-generation-runtime-browser-coverage-design.md`

`src/app/api/images/route.ts` should stay unchanged unless the new real route-contract browser spec exposes a verified production bug.

## Files Expected Not To Change

- `src/lib/image-request.ts`
- `src/lib/image-studio-generation.ts`
- `src/lib/image-studio-proxy.ts`
