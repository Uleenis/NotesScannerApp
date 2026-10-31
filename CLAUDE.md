# NotesScannerApp

iOS app that turns photos of handwritten notes into faithful digital text. It never invents text: fidelity to the page comes before readability.

## Stack

- App: Expo SDK 57, React Native 0.86, React 19, TypeScript strict. Expo has changed: read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing app code.
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions in TypeScript on Deno), Paris region.
- Development build: `expo-dev-client`, Android built locally on the PC without EAS (`docs/architecture.md`, `modules/document-scanner/`); Expo Go no longer runs the app.
- Reading model: `gemini-3.6-flash`, prompt V0, default temperature, `thinkingBudget: 0`, called only from Edge Functions.
- Reading service: Python 3.13 in `services/reading/` (FastAPI, Kraken 7.1.1, PyTorch for the processor only), one Docker image. It runs on the PC next to the local Supabase stack until Cloud Run, in the pre-beta slice (after slice 8, with the paid accounts).

## Layout

- `src/app/`: routes (Expo Router) and their `_layout.tsx`, nothing else.
- `src/components/`: shared components; `account/` the account screen, `reading/` the reading screens (document, formulas, word editor, edit mode, alerts), `capture/` the camera.
- `src/i18n/`: language files (`en.ts`, `fr.ts`) and the choice of language.
- `src/auth/`: the anonymous account, the account provider, sign-up and sign-in by e-mail code, the transfer of an anonymous account.
- `src/lib/`: the Supabase client and its config, secure session storage, legal links, opening a link, the action menu.
- `src/notebooks/`: reading, creating and caching notebooks, and their correction level (`level.ts`, the menu item `use-level-item.ts`).
- `src/capture/`: usage limits before the camera, the system scanner (`scanner.ts`), the import from the gallery (`importer.ts`) and the measurement export of the development build (`measure.ts`), the sharpness check (`sharpness.ts`), preparing and sending a page.
- `modules/document-scanner/`: the local Expo module of the system scanner (ML Kit on Android, VisionKit on iOS). The native folders `android/` and `ios/` are made by `npx expo prebuild` and never tracked.
- `src/pages/`: what a user sees of a page: lists, text, photo, title, formulas (`formulas.ts`, `tex.ts` with MathJax), words and corrections (`words.ts`), the edit mode (`edit.ts`), alerts, the size of a photo read from its JPEG header (`photo-pixels.ts`).
- `src/search/`: the search: the calls to `search_pages` and `suggest_words`, the box of a position, the excerpt and the suggestion text helpers; the screen is `src/app/search.tsx`.
- `src/render/`: the rich rendering of a page: the parser of the accepted marks, the call to `render-page`, the saved choice of display and when to ask; its switch and body are in `src/components/reading/`.
- `src/export/`: the PDF and Markdown export of a page, a chapter or a notebook: the plan and document, the Markdown and HTML writers, the files and the share sheet, the wait; the menu item is `useExportItem`. `src/export/data/` is the export of "my data": the ZIP writer, the reads with the rights of the user, the archive, the photos, the hook of the account screen.
- `src/training/`: the learning of the user's handwriting: the birth year and the country, the reads and writes of the consent and of the parent's code, the withdrawal, the writing test (its two texts, the calls, the sending in order); its screens are `src/app/training/`.
- `src/theme.ts`: colors, fonts and type sizes of the design direction.
- `tests/`: Jest tests and their fixtures. No text of a page may enter the repository.
- `supabase/migrations/`: the only way the schema changes.
- `supabase/templates/`: the e-mail templates, a code and never a link.
- `supabase/functions/`: Edge Functions, their shared code in `_shared/`, their Deno tests in `tests/`.
- `supabase/tests/database/`: pgTAP tests. `supabase/tests/concurrency/`: parallel-call tests.
- `services/reading/`: the reading service (Python, FastAPI, Kraken): `/recognize` reads A from a photo, `/arbitrate` aligns A with B1 and B2, applies the rules and writes A through `record_reading_a`. The same package holds the trainer (`harvest.py`, `training.py`, `trainer.py`), tested by `check.sh`.
- `services/training/`: the image of the trainer (the reading package with torch for CUDA) and its compose file; never built in CI.
- `scripts/merge-pr.mjs`: the only way a PR is merged. `scripts/deploy-function.mjs`: the only way an Edge Function is deployed. Their rules live in `scripts/merge-gate.ts`, tested by `tests/merge-gate.test.ts`.
- `.githooks/pre-push`: refuses pushes to `main` and remote deletions.
- `docs/slice.md`: the state of the current slice. `docs/architecture.md`: the detailed contracts of each part (bounds, answers, refusals), read for the part a branch touches.
- `.claude/agents/`: the `code-reviewer` (Sonnet) and `security-reviewer` (Opus by default; spawned with `model: "sonnet"` except on a critical branch) subagents. `.claude/settings.json`: the guardrails, tested by `tests/guardrails.test.ts`.

## Commands

| Command | Does |
|---|---|
| `npm run typecheck` | TypeScript compile check |
| `npm run lint` | ESLint |
| `npm test` | Jest |
| `npm run audit` | Dependency audit with the allowlist in `audit-ci.json` |
| `npm run db:start` / `npm run db:stop` | Start or stop the local Supabase stack (Docker) |
| `npm run db:test` | pgTAP tests on the local database |
| `npm run db:test:concurrency` | Parallel `charge_page` calls, relaunch runs, transfers, library operations, corrections and edits on the local database (needs `db:start`, and a `db reset` just before) |
| `npm run functions:check` | Deno type check of the Edge Functions |
| `npm run functions:lint` | Deno lint of the Edge Functions |
| `npm run functions:test` | Deno tests of the Edge Functions |
| `npm run service:build` | Build the image of the reading service |
| `npm run service:test` | Build the check stage of the image and run ruff, mypy, pytest and pip-audit in it |
| `npm run service:start` / `npm run service:stop` | Start the reading service on the network of the local stack (needs `db:start`), waiting until it answers, or stop it |
| `npm run trainer:start` / `npm run trainer:stop` | Build and start the trainer on the GPU, on the network of the local stack, or stop it |
| `node supabase/tests/manual/read-photo.cjs --photo <jpeg>` | Read one photo for real through `read-page` on the local stack (needs `functions serve` and the service), then wait for A |
| `node supabase/tests/manual/reading-report.cjs [--page <id>] [--user <id>]` | For the last pages of the local stack: status, type, language, B1, A, positions by kind of anchor; no text |
| `node scripts/merge-pr.mjs <number>` | Merge a PR through the gate of `main` |
| `node scripts/deploy-function.mjs <name>` | Deploy an Edge Function from a clean, green `main` |

All of them run in CI on every push (`.github/workflows/checks.yml`), plus gitleaks: five jobs, `app`, `functions`, `database`, `secrets` and `reading` (the image of the service, built with a cache, then `check.sh` in it).

## Workflow

The owner does not read the code. What protects `main` is the spec, the tests, the checks and the fresh reviews below: skip none of them.

- One slice at a time. Its spec and its plan live in the owner's vault, outside the repository. `docs/slice.md` says where they are, which branches are done and which one is next.
- One session per branch. "Continue la tranche." means: read `docs/slice.md` and the slice document, do the next branch from start to merge, update `docs/slice.md`, and stop; the branch after it gets a new session. If `docs/slice.md` names no next branch, stop and ask.
- Each branch has a level in `docs/slice.md`: ordinary, sensitive (access rights, users' files, hostile input, deletion) or critical (accounts and authentication, secrets, exposure of a service, production, money). In doubt, the level above.
- Design the closed case first: allow-lists rather than deny-lists, deny by default, the smallest surface, explicit bounds on everything a user or a model writes (size, count, depth, time). Never a deny-list for hostile input.
- Tests that encode the criteria of the branch are written first and fail before the code exists.
- Before the PR, `typecheck`, `lint`, `test`, `audit`, `functions:check`, `functions:lint`, `functions:test`, `db:test`, `db:test:concurrency` and `service:test` pass locally (the last three need Docker; if it is off, say so and let CI run them).
- Review, one round only, no more agents than this: a fresh `code-reviewer` with the spec, the criteria of the branch and the branch name (paths, not pasted text). On a sensitive branch, also one fresh `security-reviewer` spawned with `model: "sonnet"`; on a critical branch, that `security-reviewer` on its default Opus. An ordinary branch gets the `code-reviewer` alone. A change that only moves dependency versions (CI and the audit already judge it) gets none. Fix the findings and check the fixes with the tests (a parallel test for locks), not with a second review; no second round, no extra agent. What is left goes in the PR as set aside with its reason, an important security risk left open also in `../Pour Tim.md`, and a blocking finding still open stops the session and is told to the owner.
- Keep the session light: read files by excerpts when possible, run the whole test suite once before the PR rather than after each edit.
- The PR explains every change in plain terms and ends with a `## Review` section: every finding, and what was done about it, fixed or set aside with the reason.
- Merge only with `node scripts/merge-pr.mjs <number>`, once CI has run on the last commit. It judges the PR with the gate of `main` (`scripts/merge-gate.ts`), never with the branch's own copy, and refuses while one of the five checks (`app`, `functions`, `database`, `secrets`, `reading`) is not green, while the branch lacks the last commit of `main`, without a `## Review` line, or when the PR changes a guarded file: `.claude/`, `.githooks/`, `.github/`, `scripts/`, `tests/merge-gate.test.ts`, `tests/guardrails.test.ts`, `.gitleaks.toml`, `.gitleaksignore`. These are the referee: they are denied to the Edit and Write tools, never write them by another path; when a slice needs one changed, prepare one patch outside the repository for the whole slice, write it in `../Pour Tim.md`, and go on. Every other file, `package.json` and the configuration files included, Claude changes and merges like the code. Never `gh pr merge`, never push to `main`, never rewrite history.
- The pre-push hook in `.githooks/` refuses any push to `main` and any deletion of a remote branch. It works once the owner has run `git config core.hooksPath .githooks` in the clone. At the start of a session, `git rev-parse --git-path hooks` must print `.githooks`; if not, stop and ask the owner. Create PRs with `--body-file`, so their text never looks like a denied command.
- Before changing a part, read its section of `docs/architecture.md`; a branch that changes a contract there (bounds, answers, refusals, who writes what) updates that section, and the matching rule in Security rules when the rule itself changes. The last commit of each branch updates `docs/slice.md`. After the merge, the session ends; when the branch was the last of the slice, it first writes the Bilan and the status below.
- Decisions: take alone what stays within the spec and a PR can undo (shape of a table, a limit, a free library, a dependency or a configuration change, the order of the work, a fix from a review), and write each one, in French, one line with its reason, in `../Tranche N/Décisions.md`. The owner decides what costs money or creates an account, touches secrets or authentication settings, changes what the app promises or departs from the spec, or leaves a known security risk unfixed: write it in `../Pour Tim.md`, one plain sentence with a proposal, take meanwhile the safest option that is easiest to undo, and go on with the branch. Once the owner answers, the question leaves `../Pour Tim.md` and its answer goes into the slice's `Décisions.md`. Stop only when nothing can move without the answer, or when a check is still red after two attempts to fix it.
- At the end of each slice, write `../Tranche N/Bilan.md` in French (what the slice does, in plain terms; its measures; what is left for the owner), the phone checks of the slice in `../Tranche N/Vérifications.md` (short, about ten minutes, step by step with the expected result, on the owner's Android phone), and rewrite the "Current Status" of `../../AGENTS.md` in ten lines at most.
- Real Gemini readings are few: the free key allows about 20 calls a day and a page costs two. Tests and measures use stored readings; a real reading waits a minute after the previous one.

## Production

- `.github/workflows/deploy.yml` deploys production after every green run of Checks on `main`: `supabase db push` sends the new migrations to `notes-app`, then every Edge Function is deployed with the settings of `supabase/config.toml`. A migration is therefore live as soon as it is merged: it must apply to a database that already holds data, and it is undone by a new migration, never by editing an old one. `node scripts/deploy-function.mjs <name>` stays as a manual fallback.
- The owner's alone: secrets (Edge Function secrets, Vault, GitHub environments), authentication settings in the dashboard, who may call a service and public access, billing, accounts and projects, and every `gcloud` command.
- `.claude/settings.json` denies reading `supabase/functions/.env`, `services/reading/.env` and `services/training/.env`, the commands and tools that write to production outside the deploy workflow, `gcloud`, computer use, `gh pr merge`, pushes to `main` and changes to the git hooks. The secret of the reading service is in the environment of its container: read its logs with `docker logs notes-reading`, never `docker inspect` or `docker exec`. Search `supabase/functions/*/`, never `supabase/functions` recursively, so the secrets file is not read by accident.
- Never read page text or images from production.

## Code rules

- No comments in code.
- Never reference conversations in code, commits or PRs.
- Everything in English.
- TypeScript strict, no `any`, no `@ts-ignore`.
- Every user-facing string lives in the language files (English and French), never inline.
- Colors only come from src/theme.ts.
- The app is published on iOS and checked on Android: no iOS-only API (`ActionSheetIOS`, a `KeyboardAvoidingView` behavior set for iOS alone, and the like) without an equivalent checked on Android.

## Security rules

- Row level security on every table, deny by default, `user_id = auth.uid()` and only the operations the client is allowed. Every policy has a test proving a user can neither read nor modify another user's data. `rls.test.sql` fails if a table in `public` has RLS disabled.
- A new table in `public` gets no right by default, locally and in production: every migration that creates one grants its rights explicitly, to `authenticated` column by column and to `service_role` (`select, insert, update, delete`). `tests/server-grants.test.ts` and `server-grants.test.sql` fail otherwise.
- Age and consent: `profiles.birth_year` and `profiles.country` are written once, together, by a registered account only; the client inserts only a `user` consent (`kind` and `version`), which the database refuses for an anonymous or unconfirmed account, without a birth year, below the age of digital consent of the country (16 when unknown, the youngest possible age), for another version or when one is active. A `parent` consent and a withdrawal are written by the server only; a consent row never changes except to receive its `revoked_at` once.
- Parent consent: `request-parent-consent` and `confirm-parent-consent` take the account from the verified token alone; the code is drawn by the database, kept as a bcrypt hash, valid 7 days and 5 attempts, then removed; three sends per account in 24 hours, three per address in 7 days (counted by a peppered hash) and fifty for the whole service in 24 hours; the e-mail is a fixed plain text with the code alone, no link and no user text; no log carries the address, the code or the provider's answer; without `RESEND_API_KEY` nothing is sent or written.
- `profiles` has no `user_id`: its key `id` is the account id and its rule is `id = auth.uid()`. Tables written only by the server have no default for `user_id`: the server always gives it.
- The client only writes notebooks, chapters, pages, corrections, consents, its interface language, birth year and country. Everything else is written by the server.
- The client deletes no row and changes neither `pages.notebook_id` nor `pages.chapter_id`: moves and deletions go only through server-only SQL functions, called by Edge Functions with the owner of the verified token, which take the user's advisory lock first, then the rows of notebook, chapter and pages by id. The Edge Function erases the files first.
- Storage buckets are private; a user only reads photos under their own `user_id`. `alto` (the ALTO files of A, `application/xml`, 5 MB at most) and `models` (personal HTR models) have no rule at all: only the server reads or writes them. A file of a page lives under `{user_id}/{page_id}/`, a model under `{user_id}/`.
- Every foreign key `(…, user_id)` has an index starting with its columns.
- Reading A, its positions, the language of the page and its `missing_line` alert are written only by `record_reading_a` (server only), in one transaction, the page row locked.
- Reading with a personal model: `/recognize` takes the owner from `read-page`, `relaunch-page` or `set-page-type`, downloads only `models/{user_id}/{id}.safetensors` of the owner's active row, checks it with `checked_model` (SHA-256 of the row) and its Kraken metadata against the generic's (codes of 1 to 4 labels), loads it by `kraken.models.load_safetensors` alone (never `load_models`, which tries the CoreML loader first and would build the network a polyglot file declares), erases the file at once, keeps 4 models in memory and drops those of a user who no longer has them; any failure reads with the generic. `record_reading_a` keeps the model of A (`readings.htr_model_id`, tied to the owner) and refuses a position decided by a rule unless that model is the owner's active one with a CER of at most 0.129.
- `date_incoherent` alerts are written and erased by `private.refresh_dates` alone, after every change to a notebook's pages, texts or level: only for a notebook at `journal` and the pages that are read, of text and in French, only when the notebook has at least 4 dated pages and at most 500; they carry no value and change no text.
- The client writes `corrections` (insert only, never empty, the columns `private.prepare_correction` checks). Page alerts, `page_gaps`, `edit_page` and the text a page shows are written by the server only.
- `pages.page_type`, `pages.language` and `notebooks.correction_level` are written by the server only. The level moves only through `set-correction-level` (verified token, a body of exactly `notebook_id` and `level`) and `set_correction_level`, under the user's advisory lock; the database refuses `journal` and `grammar` unless the user has an active model in service (CER of 0.129 at most), and the withdrawal puts every notebook back at `course`.
- `lexicon_entries` is read by its owner and written by `private.refresh_lexicon` alone; `private.dictionary_words` is unreachable by the client. `suggest_words` keeps `user_id = auth.uid()` by hand.
- `page_renderings` is read by its owner and written by the server alone; `render_daily_counts` and `charge_render` are the server's alone. The Markdown of a rendering is hostile input: the client shows only an allow-list of marks.
- `render-page` takes the owner from the verified token alone, sends the model the cleaned text of the page and nothing else, charges one rendering of the day before the call (never the monthly limit), and stores a rendering only when `checkFidelity` finds the same words and signs as the input once the accepted marks are removed from both sides; it never logs a text.
- Exports: every text goes through `escapeHtml` or `escapeMarkdown` before it enters a file; the PDF's HTML is fixed templates plus escaped text, with a content security policy that forbids scripts and outside resources, and formulas as `data:` images; a file name is reduced to an allow-list; the export file lives in a folder of its own in the cache, erased at once if nothing was shared and otherwise swept at the next export or the next start of the app (a share target may read it after the sheet closes); a Markdown formula is kept only if it fits a closed alphabet, so no link, image, heading or address can be born from LaTeX.
- Export of "my data": built on the phone with the rights of the user, never by a function; it reads an allow-list of tables and columns (no `user_id`; the models without their file path or hash), always filtered by the user and, for the page tables, by the pages asked for, and drops any other row; the ZIP only accepts fixed names (`README.txt`, `export.json`, `profile.json`, `usage.json`, `notebooks.json`, `training.json`, `writing-tests/<uuid>/1.jpg|2.jpg`, `pages/<uuid>/page.json|text.txt|original.jpg|prepared.jpg`), never a name made from user text; it is written file by file with a bound of 3.5 GB and 10,000 pages, in a folder of its own in the cache, erased at once if cancelled, failed or not shared, and otherwise swept like the other exports.
- Withdrawal of the training consent: `revoke-training` takes the account from the verified token alone, erases the files of the account in `models` and the folder `writing-tests` of `photos` first, then `revoke_training` (server only, the user's advisory lock) dates the withdrawal, deletes the request to a parent, the personal models, and puts the notebooks back at `course`, then the files are erased once more; it logs no identifier.
- Writing test: `prepare-writing-test` and `check-writing-test` take the account from the verified token alone and a body of exactly `template` or `test_id`; `writing_tests` is read by its owner and written only by `begin_writing_test`, `finish_writing_test` and `fail_writing_test` (server only, the user's advisory lock first, consent still active); one test in progress at a time and three tests in 24 hours at most; its photos live under `photos/{user_id}/writing-tests/{test_id}/`, are uploaded through signed addresses made for those two paths alone, and are erased as soon as the test is rejected, failed, replaced or its consent withdrawn; the reading service answers numbers only for `/check-writing`, and no text, photo or path is logged.
- No secret in the repository. Secrets live in Supabase Edge Function secrets or Google Secret Manager; locally, in `supabase/functions/.env`, `services/reading/.env` and `services/training/.env`, all ignored by git and never copied into the image (`.dockerignore` lets only the listed files in).
- The reading service is never public: it refuses every call without the shared secret, and locally it is published on `127.0.0.1` only, never on the local network. The app only holds the Supabase URL and publishable key. The app reaches production through `.env.development.local`, ignored by git, holding only the production URL and publishable key; renamed `.env.development.local.off`, the app is back on the local stack.
- Logs never contain page text or images.
- Import from the gallery: a picked file is hostile input. `importer.ts` accepts only a `file:///…/ImagePicker/<name>.<ext>` address without `..` (any other address is set aside and never erased), a file of 1 byte to 64 MB, a format read from its first bytes (JPEG, PNG, WebP, HEIC and nothing else), and a pixel count bounded before anything decodes it (50 Mpx, 16,000 px a side: the header for a JPEG or a PNG, the size reported by the system for a WebP or a HEIC); a file that fails is erased and counted. The photo picker is never the legacy one. Each image is saved again as one JPEG without metadata, shrunk above 12 Mpx, before it is checked and sent with `source = import`.
- Model output is text, never code: never executed, rendered without HTML or active links.
- Usage limits are enforced by Edge Functions, never by the app.
- An e-mail address is kept by an account only once its code is proven (`enable_confirmations = true`, local and production).
- No account is created in advance for an address: the hook `private.refuse_email_signup` (`[auth.hook.before_user_created]`, local and production) refuses every new account that comes from an e-mail or a phone number. Without it, anyone could create an account for someone else's address with a password they know, and keep access to it once the owner signs in by code. The signup settings stay open: turning off `enable_signup` blocks the anonymous accounts, turning off the e-mail one blocks the sign-in by code.
- Training: `training-claim`, `training-upload` and `training-report` refuse everything without `TRAINING_SECRET` (32 characters at least, in `X-Training-Secret`, compared in constant time) and take bodies of exactly their fields; a task gives the trainer only the data of one consenting user (the accepted test, the active model, the 300 last read text pages, never math or retouched ones, with B1 and the corrections) through addresses signed for one hour and given without their host; the upload path is fixed by the database, `models/{user_id}/{attempt}.safetensors`; `training_tasks` is the server's alone, one open task per user and one claimed task at a time for the whole service; the active model is replaced only by `report_training_task`, under the user's lock with the consent active, when the new CER is lower and it writes no more planted faults correctly; a report after a withdrawal is refused and its file erased. The trainer holds the Supabase URL and `TRAINING_SECRET`, never the service key, loads only `.safetensors` files checked by their SHA-256 (the generic one included) and checkpoints of its own task folder, and erases that folder after each task.
- `delete-account` takes the account from the verified token alone, never from the request, erases the files of the account in `photos`, `alto` and `models` before the account, then `alto` once more (an A that ended meanwhile; a failure there is logged as `account_files_left`, the deletion stands), and logs no identifier.
- `transfer-account` takes both accounts from the two verified tokens alone (the first must be anonymous, the second registered), never from the request. It copies the photos, moves the rows in one transaction (`transfer_account_rows`, which rewrites the paths of photos and ALTO files), copies the ALTO files (after the rows, so that an A written meanwhile is not left behind), then erases the old files of the three buckets and the anonymous account; every step can be played again. It refuses while a page of the anonymous account is being read, is never stopped by a usage limit, and logs no identifier.

## Dependency audit allowlist

`audit-ci.json` allows two high advisories: one in development tooling that never ships in the app, one in the app pending the owner's answer. Remove an entry as soon as a fix can be taken.

- `GHSA-mrhx-c7xc-m3w5`: `zod` 3.25.76 via `@expo/cli` and `eslint-plugin-react-hooks` (fixed in zod 4.6.6, a major version those tools do not take yet), memory exhaustion when validating oversized collections. Allowed on 24/10/2026 at the owner's choice; retry the upgrade with the next Expo SDK patch.
- `GHSA-qr28-fpjm-wq7f`: `decode-uri-component` 0.2.2 via `expo-router` 57 and `query-string` 7, quadratic time on a long run of malformed percent-encoded text (a crafted deep link can stall the app). It ships in the app. The fix, 0.5.1, is ESM only and `query-string` 7 loads it with `require`; `expo-router` 58 (next Expo SDK) takes it. Allowed on 29/10/2026 as the safest option easy to undo, pending the owner's answer in `../Pour Tim.md`.

`services/reading/audit-allowlist.txt` allows one advisory to pip-audit, in the reading service:

- `GHSA-qqmf-gpg7-g8gw`: `lightning` 2.6.1, pinned exactly by Kraken 7.1.1 (no later Kraken release), runs code named in a crafted checkpoint loaded by `load_from_checkpoint`. Reading loads only `.safetensors` files through `kraken.models.load_safetensors`, never through Lightning: today the `medium` model checked by its hash. A checkpoint is code whatever the version of Lightning (Kraken's training loads `.ckpt` files with `weights_only=False`), so from slice 5 the service loads only checkpoints it wrote itself, from storage only the server can write, never a file from a user. Dependabot ignores `kraken` and `lightning`: at the start of each slice, check by hand whether a Kraken release allows `lightning` 2.6.6, and remove the entry when it does.

## Reading chain dependencies

`kraken`, `torch`, `torchvision`, `lightning` and the versions in `constraint-dependencies` of `services/reading/pyproject.toml` are those that produced the measures of the spikes. Dependabot ignores the first four. Change them only together with the measure of criterion 1 of slice 2 run again; a package outside the reading itself (network, server) can move to a release that fixes an advisory.

## Expo-managed dependencies

`expo`, `expo-*`, `react`, `react-dom`, `react-native`, `react-native-screens`, `react-native-safe-area-context`, `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler`, `react-native-svg`, `@types/react`, `jest`, `jest-expo`, `eslint-config-expo` and `typescript` are pinned by the Expo SDK. Dependabot ignores them. Upgrade them together with `npx expo install --fix`, during an Expo SDK upgrade, never one by one.
