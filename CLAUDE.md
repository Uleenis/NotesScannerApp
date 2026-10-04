# NotesScannerApp

iOS app that turns photos of handwritten notes into faithful digital text. It never invents text: fidelity to the page comes before readability.

## Stack

- App: Expo SDK 57, React Native 0.86, React 19, TypeScript strict. Expo has changed: read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing app code.
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions in TypeScript on Deno), Paris region.
- Reading model: `gemini-3.6-flash`, prompt V0, default temperature, `thinkingBudget: 0`, called only from Edge Functions.
- Reading service: Python in `services/reading/`, deployed on Cloud Run (from slice 2).

## Layout

- `src/app/`: routes (Expo Router) and their `_layout.tsx`, nothing else.
- `src/components/`: shared components.
- `src/i18n/`: language files (`en.ts`, `fr.ts`) and the choice of language.
- `src/theme.ts`: colors, fonts and type sizes of the design direction.
- `tests/`: Jest tests.
- `supabase/migrations/`: the only way the schema changes.
- `supabase/functions/`: Edge Functions.
- `supabase/tests/database/`: pgTAP tests.
- `services/reading/`: reading service.

## Commands

| Command | Does |
|---|---|
| `npm run typecheck` | TypeScript compile check |
| `npm run lint` | ESLint |
| `npm test` | Jest |
| `npm run audit` | Dependency audit with the allowlist in `audit-ci.json` |
| `npm run db:start` / `npm run db:stop` | Start or stop the local Supabase stack (Docker) |
| `npm run db:test` | pgTAP tests on the local database |
| `npm run functions:test` | Deno tests of the Edge Functions |

All of them run in CI on every push (`.github/workflows/checks.yml`), plus gitleaks.

## Workflow

- One slice at a time, split into small branches. One branch, one PR, small diff.
- Tests that encode the slice criteria are written first and fail before the code exists.
- Every change is explained in plain terms in the PR: the owner is learning and must understand what they merge.
- Never merge a PR and never push to `main`. The owner merges in GitHub after the checks are green.
- Never start the next branch before the previous PR is merged.
- Never touch the production Supabase project by hand: no SQL, no migration, no deployment outside the agreed workflow.

## Code rules

- No comments in code.
- Never reference conversations in code, commits or PRs.
- Everything in English.
- TypeScript strict, no `any`, no `@ts-ignore`.
- Every user-facing string lives in the language files (English and French), never inline.
- Colors only come from src/theme.ts.
- Colors only come from src/theme.ts.

## Security rules

- Row level security on every table, deny by default, `user_id = auth.uid()` and only the operations the client is allowed. Every policy has a test proving a user can neither read nor modify another user's data. `rls.test.sql` fails if a table in `public` has RLS disabled.
- The client only writes notebooks, chapters, pages, corrections, consents, its interface language, birth year and country. Everything else is written by the server.
- Storage buckets are private; a user only reads files under their own `user_id`.
- No secret in the repository. Secrets live in Supabase Edge Function secrets or Google Secret Manager. The app only holds the Supabase URL and publishable key.
- Logs never contain page text or images.
- Model output is text, never code: never executed, rendered without HTML or active links.
- Usage limits are enforced by Edge Functions, never by the app.

## Dependency audit allowlist

`audit-ci.json` allows two high advisories with no patched release, both in development tooling that never ships in the app. Remove an entry as soon as a fix is released.

- `GHSA-vfj7-8cjw-p6xm`: `braces` 3.0.3 via Jest, stack exhaustion on crafted glob patterns.
- `GHSA-86w9-cpqp-85rv`: `node-forge` 1.4.0 via `@expo/cli` code signing, lax RSA signature parsing.

## Expo-managed dependencies

`expo`, `expo-*`, `react`, `react-native`, `@types/react`, `jest`, `jest-expo`, `eslint-config-expo` and `typescript` are pinned by the Expo SDK. Dependabot ignores them. Upgrade them together with `npx expo install --fix`, during an Expo SDK upgrade, never one by one.
