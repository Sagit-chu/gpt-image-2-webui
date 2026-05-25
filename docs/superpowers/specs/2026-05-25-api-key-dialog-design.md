# API Key Dialog Design

## Goal

When the user clicks generate without an `API key`, the app should open a dialog that lets them enter only the `API key`, optionally remember it locally, and then automatically continue the pending generation after confirmation.

## Confirmed Requirements

- Trigger: user clicks `Generate images` while `apiKey.trim()` is empty.
- The app must show a dialog instead of only showing a toast or forcing the user to use the left-side connection form.
- The dialog should ask for `API key` only.
- The dialog must include the guidance text:
  `请在 API 密钥页面创建生图专用 key，粘贴在此处，开始使用`
- After the user confirms, the app should automatically continue the generation request they originally attempted.
- The dialog must support remembering the `API key` locally.

## Non-Goals

- No `base url` editing inside the dialog.
- No provider-specific validation beyond the existing normal submission path.
- No new storage backend; reuse existing localStorage behavior.
- No redesign of the empty canvas or connection section.

## Current Code Constraints

- Submission entrypoint is `handleSubmit()` in `src/components/image-studio.tsx`.
- Current API-key-related interrupt flow only covers the "remember this key" confirmation dialog via `promptToRememberApiKey()`.
- Local persistence already exists through `rememberKey`, `writeStoredConnectionPreferences()`, and the legacy compatibility keys.
- The existing UI already uses `AlertDialog` primitives and should continue using the same visual/system pattern.

## Recommended Approach

Add a second dialog dedicated to missing API keys and make submission resumable.

### Why this approach

- Matches the requested UX exactly.
- Keeps the connection form unchanged and avoids overloading the empty state panel.
- Reuses the existing dialog system and local persistence logic.
- Keeps the submission flow centralized in `handleSubmit()` instead of branching generation behavior across multiple UI zones.

## Interaction Design

### Missing-key trigger

When `handleSubmit()` runs:

1. Validate prompt and custom size as it does today.
2. If `apiKey.trim()` is empty:
   - mark that a generation submission is pending
   - open the new API-key dialog
   - stop the current submit path before any generation work starts

### Dialog contents

- Title: localized "Fill in API key" copy
- Description: the required Chinese guidance text
- Input: masked API-key field with `sk-...` placeholder
- Remember checkbox: localized "Remember on this device"
- Actions:
  - Cancel
  - Confirm and continue

### Confirm behavior

When the user confirms:

1. Validate that the dialog input is non-empty.
2. Copy the dialog value into the main `apiKey` state.
3. Apply the remember-choice to `rememberKey`.
4. Close the dialog.
5. Resume the previously blocked submit automatically.

### Cancel behavior

- Close the dialog.
- Clear pending-submit state.
- Do not generate anything.

## State Design

Add the following client-side state in `src/components/image-studio.tsx`:

- dialog open state for the missing-key dialog
- temporary API-key input state for the dialog field
- temporary remember-choice state for the dialog checkbox
- pending-submit flag indicating that the user already tried to generate

These states should be isolated from the generation result state and should not reset history or progress until a real generation actually starts.

## Implementation Notes

### Submission resumption

To avoid fabricating a DOM event or duplicating the whole submission body:

- extract the real generation path from `handleSubmit()` into a dedicated async function named `startGeneration()`
- let `handleSubmit()` only prevent default, run lightweight guards, and delegate
- after dialog confirmation, call the same `startGeneration()` function directly

This produces one source of truth for generation behavior and avoids divergence between normal submit and resumed submit.

### Remember-key integration

- Reuse the current `rememberKey` storage effect.
- The dialog confirm action should set `rememberKey` before or together with `apiKey`, so the existing effect persists the value normally.
- The existing "remember this key" confirmation dialog should remain available for the regular left-side input blur behavior; the new missing-key dialog is a separate flow.

### Empty state

- Do not move the connection form.
- Do not embed a new inline API-key form into `EmptyCanvas`.
- The right-side empty state remains visual-only except for the new modal trigger path via submit.

## Error Handling

- Empty input inside the dialog: show an inline validation error or existing toast, and keep the dialog open.
- Cancel: no error toast needed.
- If generation later fails after confirmation, existing generation error handling remains unchanged.

## Testing Plan

### Source-level tests

Add or update tests to confirm:

- the missing-key dialog state and copy exist
- submission opens the dialog when `apiKey` is empty
- confirm action routes into the same generation path
- the remember toggle from the dialog is wired into persisted preferences

### Regression coverage

Keep current checks green for:

- remember-key dialog behavior
- elapsed generation timer behavior
- stop-generation and timeout controls added earlier
- route debug metadata and request handling

## Risks

- If the resumed-submit path duplicates generation logic instead of extracting it, later changes may break one path and not the other.
- If dialog state writes to `apiKey` without coordinating `rememberKey`, local persistence can silently fail or save unexpectedly.
- If the dialog resets generation UI too early, users may lose the current result/history before a real request starts.

## Files Expected To Change

- `src/components/image-studio.tsx`
- `src/lib/i18n.ts`
- one or more tests under `tests/`
