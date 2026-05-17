# Agent Notes

## Project

HC Studio is a Next.js 16 app with React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Base UI, OpenAI SDK, and Sonner.

## Key conventions

- Use `pnpm` 10.33.0.
- Read the relevant Next.js docs in `node_modules/next/dist/docs/` before changing framework-specific behavior.
- Keep changes focused; avoid unrelated refactors.
- Prefer existing local patterns in `src/`.

## Runtime architecture

- `src/app/page.tsx` renders the main workspace.
- `src/app/layout.tsx` sets fonts, metadata, locale, and toaster.
- `src/components/image-studio.tsx` is the main client workspace.
- `src/app/api/images/route.ts` is the server proxy for image generation and edits.
- `src/lib/image-request.ts` normalizes endpoints and parses image payloads.
- `src/lib/i18n.ts` owns locale selection and UI copy.

## Build and deploy

- `next.config.ts` uses `output: "standalone"`.
- `Dockerfile` builds a multi-stage image for GHCR and local Docker testing.
- `.github/workflows/ci.yml` runs `pnpm build` on push and pull request.
- `.github/workflows/docker-publish.yml` publishes tag pushes to GHCR.

## Working rules

- Do not revert user changes.
- Use `apply_patch` for file edits.
- Verify build or Docker changes before claiming success.
