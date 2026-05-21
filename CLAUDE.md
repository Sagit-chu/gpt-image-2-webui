# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
pnpm dev              # Start dev server (webpack) at localhost:3000
pnpm dev:turbo        # Start dev server (turbopack)
pnpm build            # Production build (standalone output)
pnpm start            # Serve production build
pnpm lint             # ESLint (flat config, no args needed)
```

Tests are standalone scripts using `node:assert/strict` (no test framework):

```bash
npx tsx tests/image-request.test.ts       # Run a single test
npx tsx tests/model-options.test.ts       # Run another
```

Run all tests:

```bash
for f in tests/*.test.ts; do npx tsx "$f"; done
```

## Architecture

Single-page Next.js 16 app (React 19, App Router) that wraps OpenAI-compatible image APIs in a creative workspace UI.

### Request flow

1. `src/app/page.tsx` (server component) resolves locale from cookies/headers and reads `NEXT_FIXED_BASE_URL`, then renders `<ImageStudio>`.
2. `src/components/image-studio.tsx` (client component) is the entire workspace: prompt editor, reference uploads, output controls, generation grid, and iteration board. All UI state lives here.
3. On generate, the client POSTs multipart form data to `/api/images`.
4. `src/app/api/images/route.ts` validates inputs, instantiates the OpenAI SDK client with the user-provided or env-based API key, calls `images.generate` or `images.edit`, then materializes results (downloads remote URLs to base64 data URIs) before returning JSON.

### Key modules

- `src/lib/image-request.ts` - endpoint normalization (`normalizeOpenAIBaseURL`, `normalizeImageEndpoint`), response parsing (`extractGeneratedImages`), and remote-to-data-URI conversion (`materializeGeneratedImages`).
- `src/lib/i18n.ts` - 9-locale string tables, locale resolution chain (localStorage > cookie > Accept-Language > document lang).
- `src/lib/runtime-config.ts` - resolves `NEXT_FIXED_BASE_URL` env var.
- `src/lib/model-options.ts` - model list (currently `gpt-image-2` only).
- `src/lib/http-response.ts` - safe JSON response reader.

### UI layer

- shadcn/ui components live in `src/components/ui/` (Base UI primitives + CVA + Tailwind).
- Tailwind CSS 4 with `@tailwindcss/postcss`.
- Toasts via Sonner (`src/components/providers.tsx` wraps the Toaster).

## Conventions

- Package manager: **pnpm 10.33.0** (set in `packageManager` field).
- Path alias: `@/*` maps to `./src/*`.
- No test framework; tests are self-contained scripts that call `main()` and assert with `node:assert/strict`.
- Read Next.js docs in `node_modules/next/dist/docs/` before changing framework-specific behavior (Next.js 16 has breaking changes from prior versions).
- The app sends N independent single-image requests in parallel (not `n > 1` in one call) to work around provider batch limits.
- Connection preferences (API key, endpoint, remember toggle) are stored in localStorage under `imgx.connectionPreferences`.
- Locale preference persists to both localStorage and a cookie (`imgx.locale`).

## Environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Server proxy mode API key (optional; UI key takes priority) |
| `NEXT_FIXED_BASE_URL` | Lock the base URL input to a specific endpoint |
| `NEXT_ASSET_PREFIX` | Static asset prefix for CDN/sub-path deployments |
