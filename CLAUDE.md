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
- `src/auth/`: the anonymous account, the provider that opens it when the app starts and follows every change of account (sign-up, sign-in, sign-out), and the actions of the account by e-mail code (`account.ts`, `account-errors.ts`, `account-service.ts`). A sign-in from an anonymous account that has pages checks its code on a second client that keeps nothing (`getStatelessSupabase`), calls `transfer-account` with both tokens, and only then gives the account found to the client of the phone.
- `src/lib/`: the Supabase client, its config, the secure session storage, the addresses of the terms and the privacy policy (`legal-links.ts`), the opening of a web address (`open-link.ts`) and the forgetting of the data of other accounts.
- `src/notebooks/`: reading, creating and caching notebooks.
- `src/capture/`: the limits shown before the camera and the hook that opens the camera or the limit sheet, sending a page (create, prepare, upload, mark it uploaded, start the reading), shrinking the photo, the camera and network hooks. A page only counts for the user (notebook counts, last notebook, page lists) once its `uploaded_at` is set, so a page created for a photo that never arrived stays invisible.
- `src/pages/`: the pages a user sees (list, one page with its number and text, signed address of its photo, starting or restarting a reading), what a page shows according to its status, the title of a page and the gluing of its cut lines at display time (the text itself is never changed), dates without `Intl`, and the polling delays. Every query here keeps to pages whose `uploaded_at` is set.
- `src/components/account/`: the groups and rows of the account screen.
- `src/components/reading/`: the screens' parts for a reading: ink stroke, waiting view, document, original photo with its zoom, page rows and cards.
- `src/theme.ts`: colors, fonts and type sizes of the design direction.
- `tests/`: Jest tests. `tests/fixtures/b1-line-shapes.json` holds only the shape of the lines of the 18 B1 readings of the Thinking Spike (every letter is `x` or `X`, every digit `0`), with the verdict of the ground truth for each line break; no text of a page may enter the repository.
- `supabase/migrations/`: the only way the schema changes.
- `supabase/templates/`: the e-mail templates (sign-up, sign-in, confirmation). Each one shows `{{ .Token }}`, the code, and never a link; `config.toml` references them and sets the code at 6 digits, valid 10 minutes, a new one after 30 seconds, and the proof of the address before an account keeps it.
- `supabase/functions/`: Edge Functions (`prepare-page`, `read-page`, `relaunch-page`, `delete-account`, `transfer-account`), their shared code in `_shared/`, their Deno tests in `tests/`. Local secrets (`GEMINI_API_KEY`, `RELAUNCH_SECRET`) live in `supabase/functions/.env`, ignored by git. The `pg_cron` task that calls `relaunch-page` reads its secret and address from Supabase Vault, never from the repository.
- `supabase/tests/database/`: pgTAP tests.
- `supabase/tests/concurrency/`: parallel-call tests.
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
| `npm run db:test:concurrency` | Parallel `charge_page` calls, parallel runs of the relaunch task and parallel transfers on the local database (needs `db:start`, and a `db reset` just before) |
| `npm run functions:check` | Deno type check of the Edge Functions |
| `npm run functions:lint` | Deno lint of the Edge Functions |
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

## Security rules

- Row level security on every table, deny by default, `user_id = auth.uid()` and only the operations the client is allowed. Every policy has a test proving a user can neither read nor modify another user's data. `rls.test.sql` fails if a table in `public` has RLS disabled.
- `profiles` has no `user_id`: its key `id` is the account id and its rule is `id = auth.uid()`. Tables written only by the server have no default for `user_id`: the server always gives it.
- The client only writes notebooks, chapters, pages, corrections, consents, its interface language, birth year and country. Everything else is written by the server.
- Storage buckets are private; a user only reads files under their own `user_id`.
- No secret in the repository. Secrets live in Supabase Edge Function secrets or Google Secret Manager. The app only holds the Supabase URL and publishable key.
- Logs never contain page text or images.
- Model output is text, never code: never executed, rendered without HTML or active links.
- Usage limits are enforced by Edge Functions, never by the app.
- An e-mail address is kept by an account only once its code is proven (`enable_confirmations = true`, local and production).
- No account is created in advance for an address: the hook `private.refuse_email_signup` (`[auth.hook.before_user_created]`, local and production) refuses every new account that comes from an e-mail or a phone number. Without it, anyone could create an account for someone else's address with a password they know, and keep access to it once the owner signs in by code. The signup settings stay open: turning off `enable_signup` blocks the anonymous accounts, turning off the e-mail one blocks the sign-in by code.
- `delete-account` takes the account from the verified token alone, never from the request, erases the files of the account before the account, and logs no identifier.
- `transfer-account` takes both accounts from the two verified tokens alone (the first must be anonymous, the second registered), never from the request. It copies the files, then moves the rows in one transaction (`transfer_account_rows`), then erases the old files and the anonymous account; every step can be played again. It refuses while a page of the anonymous account is being read, is never stopped by a usage limit, and logs no identifier.

## Dependency audit allowlist

`audit-ci.json` allows two high advisories with no patched release, both in development tooling that never ships in the app. Remove an entry as soon as a fix is released.

- `GHSA-vfj7-8cjw-p6xm`: `braces` 3.0.3 via Jest, stack exhaustion on crafted glob patterns.
- `GHSA-86w9-cpqp-85rv`: `node-forge` 1.4.0 via `@expo/cli` code signing, lax RSA signature parsing.

## Expo-managed dependencies

`expo`, `expo-*`, `react`, `react-dom`, `react-native`, `react-native-screens`, `react-native-safe-area-context`, `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler`, `react-native-svg`, `@types/react`, `jest`, `jest-expo`, `eslint-config-expo` and `typescript` are pinned by the Expo SDK. Dependabot ignores them. Upgrade them together with `npx expo install --fix`, during an Expo SDK upgrade, never one by one.
