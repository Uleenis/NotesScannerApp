# Current slice

Slice 4 — Vérification.

Paths below are from the repository root.

- **Spec and plan:** `../../02 Design/Tranche 4.md`, one document, validated by the owner on 17/10/2026, with its decisions as proposed (the second pass always runs; the page alerts stay; no mock-up).
- **Method:** `../../01 Steps/Méthode de travail.md`, revised on 19/10/2026. One session per branch: "Continue la tranche." builds the next branch below to its merge, updates this file, and stops. Open the session with the model the table gives.
- **Next branch:** first merge PR 58 (`t4/schema`) once its five checks run green (re-run them after the owner settles the GitHub billing), with `node scripts/merge-pr.mjs 58`; then `t4/second-pass`.
- **Decisions from now on:** `../Tranche 4/Décisions.md`, in French, one line each; questions for the owner in its "Pour Tim" section.
- **Guarded files:** none planned. A branch that needs one writes it in "Pour Tim" and goes on with the others.
- **Gemini:** the tests replace Gemini; measures 8 to 10 replay stored readings. One real end-to-end reading costs two calls.
- **Slice 3 is done** (PRs 46, 49 to 53 and the PR of `t3/screens`): its Bilan is `../Tranche 3/Bilan.md`, its decisions `../Tranche 3/Décisions.md`, and the phone checks of slices 2 and 3 are in `../Vérifications 1.md`, for the owner's return.
- **After this slice:** the slices follow the order of `../../01 Steps/Périmètre du MVP.md`: 7, 9, 5, 6, 8. Cloud Run comes at the end of slice 4 (see the notes carried from slice 2). A slice whose document is missing or not validated: stop and ask.

## Branches

| # | Branch | Criteria | Level | Session | Merged by | State |
|---|---|---|---|---|---|---|
| 1 | `t4/schema` | 4, 5 | sensitive (access rights) | Sonnet, High | Claude | built, PR 58 open and not merged: GitHub Actions refuses to start (billing), see "Pour Tim" |
| 2 | `t4/second-pass` | 1, 2 | sensitive (model call) | Sonnet, High | Claude | to do |
| 3 | `t4/rules` | 3 | ordinary | Sonnet, High | Claude | to do |
| 4 | `t4/replay` | 8, 9 | ordinary | Sonnet, High | Claude | to do |
| 5 | `t4/math-check` | 10 | ordinary | Sonnet, High | Claude | to do |
| 6 | `t4/correction` | 4, 7, 11 | ordinary | Sonnet, High | Claude | to do |
| 7 | `t4/edit` | 6, 7, 11 | ordinary | Sonnet, High | Claude | to do; last of the slice: its session also writes the Bilan, the status of `AGENTS.md`, and the Cloud Run end of slice if the plan asks for it |

## Slice 3

Done: 4 branches, PRs 46, 50, 51, the PR of `t3/screens`, and outside the plan 49 (race test), 52 (`config.toml`, merged by the owner) and 53 (purge of the cron history). What it does and what is left for the owner are in `../Tranche 3/Bilan.md`. Nothing waits for the owner on a guarded file. The migrations of the slice (`20261020120000_t3_schema.sql`, `20261021120000_t3_delete_notebook_pages.sql`, `20261022120000_t3_sweep.sql`, `20261023120000_t3_purge_cron_history.sql`) and the sweep secret go to production later, the owner's.

## Slice 2

Done: 13 branches, PRs 24, 27 to 31 and 38 to 43, and the PR of branch 12; what it does, its measures and what is left for the owner are in `../Tranche 2/Bilan.md`, its decisions in `../Tranche 2/Décisions.md`. Branch 12 (`t2/formulas`) changes `package.json` and is the owner's to merge. The phone checks of slice 2 wait for the owner's return.

## Notes carried from slice 2

- Cloud Run (end of slice 4): concurrency 1, a request timeout above `ARBITRATE_TIMEOUT_MS` (30 s), a maximum number of instances; `read-page` and the relaunch task must not retry a page answered `too_complex`; give espeak an exec-allowed folder (`READING_ESPEAK_DIR`) and set `ORT_DISABLE_TELEMETRY=1` (the image does); restrict the egress of the service to Supabase; measure again an arbitration near the NER bound (about 12 s on the PC).
- Cloud Run: a bad `READING_URL` or `READING_SECRET` in production reads every page with B1 alone, with one `reading_service_misconfigured` line per cold start; the deploy must check that A gets written.
- Cloud Run: a cancelled recognition goes on in the service and holds its one-page lock; concurrency and instance count settle it. One user can keep the four places of the service busy with re-readings: add a per-user bound before Cloud Run ("Pour Tim" of slice 2).
- Do not deploy `read-page`, `relaunch-page` or `set-page-type` before the migrations of slice 2: the plan deploys nothing before the end of slice 4.
- The service key lives in the process that decodes photos, and ALTO files left behind are never swept: both are for the owner to decide before Cloud Run (`../Tranche 2/Décisions.md`). The nightly sweep of slice 3 is the place to sweep `alto` files no `readings.alto_path` names, if the owner agrees.
- Deleting a page (slice 3) erases its files in `photos` and `alto`; a page being read by A (A runs after `read`, in the background) can still record A after the deletion: `record_reading_a` answers `page_not_found` and the service erases its ALTO, as for a transfer.
- Slice 5: retiring the active personal model leaves notebooks above `course` as they are; a transfer would lose the personal model of an anonymous account, if one ever has one. Reading loads `.safetensors` files only, through `kraken.models.load_models`; never `load_from_checkpoint`.
- `set-page-type` has no section in `supabase/config.toml`: `verify_jwt` defaults to true and the handler checks the token itself. Adding `[functions.set-page-type] verify_jwt = true` can ride with the `config.toml` patch of slice 3.
- After a `supabase db reset`, the phone's Expo Go keeps a session for an anonymous account that no longer exists: clear Expo Go's data for the project before using the app on the local stack.

## Notes carried from slice 3, branch 1

- `t3/schema` adds `move_page`, `delete_page`, `delete_chapter` and `delete_notebook` (server only; the owner is a parameter; outcomes `moved`, `unchanged`, `deleted`, `page_not_found`, `chapter_not_found`, `notebook_not_found`, `page_processing`). They touch no file. `t3/delete-move` must check owner and state itself (not `processing`) **before** erasing any file, then erase the files of `photos` and `alto` by listing the folder `{user_id}/{page_id}/` (not only `page_images` and `readings.alto_path`), then call the function, which rechecks under lock; a photo uploaded or a page created between the listing and the call can leave an orphan file in `photos`, which the sweep never touches: look at it in that branch.
- The client no longer updates `pages.chapter_id`: a move is `move_page` only.
- `library-race.sh` is in `db:test:concurrency` (PR 49).

## Notes carried from slice 3, branch 2

- `t3/delete-move` adds `delete-page`, `delete-notebook`, `delete-chapter` and `move-page` (no `config.toml` section: the default `verify_jwt` is true and each handler verifies the token). The optional patch with the five explicit sections (those four and `set-page-type`) is `../Tranche 3/t3-delete-move config.toml.patch`; it can ride with the `config.toml` patch of `t3/sweep`.
- Migration `20261021120000_t3_delete_notebook_pages.sql`: `delete_notebook` now answers `(outcome, page_ids)`. Production migrations stay the owner's (this one and `20261020120000_t3_schema.sql`).
- A photo uploaded to a signed URL after its page is deleted stays orphaned (`../Tranche 3/Décisions.md`); the sweep of `t3/sweep` is limited to `alto`.
- Not measured: the time limit of an Edge Function against a notebook of several hundred pages.

## Notes carried from slice 3, branch 3

- `t3/sweep` adds `sweep-alto` (called by the `pg_cron` task `sweep-alto` at 02:30 UTC with `X-Sweep-Secret`), `public.alto_orphans` (server only) and `private.sweep_alto` (migration `20261022120000_t3_sweep.sql`). PR 51 carries no guarded file and is merged by Claude. Until the owner applies `../Tranche 3/t3-sweep config.toml.patch` (on a branch of his own from `main`, merged by him), `sweep-alto` keeps the default `verify_jwt = true` and the gateway refuses the nightly call: nothing is erased, nothing breaks. The patch declares `sweep-alto` with `verify_jwt = false` and the five library functions with `true`, and updates `tests/supabase-auth-config.test.ts`; it replaces `t3-delete-move config.toml.patch`. Do not deploy `sweep-alto` before it.
- Local secret of the sweep: `SWEEP_SECRET` among the local function secrets, `sweep_secret` and `sweep_url` (`http://host.docker.internal:54321/functions/v1/sweep-alto`) in the local Vault, set by the owner, again after each `db reset`. The steps are in `../Tranche 3/Décisions.md`.
- A scheduled call only queues a request: check `net._http_response` or the function logs, not `cron.job_run_details`, to know whether `sweep-alto` or `relaunch-page` succeeded. `cron.job_run_details` is purged each night by the branch `t3/purge-cron` (outside the plan, approved by the owner on 20/10/2026, ordinary, merged by Claude): runs that ended more than 30 days ago.
- The `config.toml` patch of the sweep was applied by the owner (PR 52, 20/10/2026): the gateway now lets the nightly call through once the secret and the migration are in production.
- `library-race.sh` failed once in CI with exit 141: `psql` piped into `head -n 1` under `pipefail` could die of SIGPIPE. It now selects its one row through a CTE, without a pipe.

## Notes carried from slice 3, branch 4

- `t3/screens` adds the chapter screen (`/chapter/[id]`), the sheets `new-chapter`, `rename` and `page/[id]/move`, and the menus (`ActionSheetIOS`, `Alert`) of the notebook, the chapter and the page. `pages` carry `chapterId`; `chapters` are a query of their own (`["chapters", userId]`, refreshed with the pages).
- Set aside after review: a stale chapter in the capture route (deleted elsewhere while the camera is open) fails the send until the user leaves the screen; the back link of a page leads to its notebook, not its chapter; the move sheet shows no progress while it waits. The `pages(count)` embed of `listChapters` answers on the local stack; no page was read through it with real rows.

## Notes carried from slice 4, branch 1

- `t4/schema` (migration `20261024120000_t4_schema.sql`) adds `corrections`, `page_alerts`, and to `page_tokens` `reading_b2`, `review_status` and the place of the word in B1 (`b1_start`, `b1_end`, in characters of the raw text of the B1 reading). `record_reading_a` keeps its signature and now reads `reading_b2`, `b1_start` and `b1_end` from each token object: `t4/rules` makes the service send them (the offsets must be in the raw text of B1, not in the NFC form `tokens.py` uses, if the two differ), and `t4/second-pass` writes the B2 row in `readings` (one B2 a page at most). The text a page shows is rebuilt by `private.recompute_page_text` from B1, the places and the corrections; a page whose positions have no place keeps its text, and a correction on such a position is refused.
- The mode "Modifier" (`t4/edit`) keeps words added and line changes outside the positions: the rebuilt text is B1 plus word replacements only, so that branch needs its own place for the text of the user (and `recompute_page_text` must respect it).
- `set_page_math` erases the corrections with the positions: `t4/correction` should ask for a confirmation before the switch when the page has corrections ("Pour Tim" of slice 4). The `math_incomplete` alert is not cleared on math to text: `t4/math-check` decides.
- `corrections-race.sh` is not in `db:test:concurrency` until the owner applies `../Tranche 4/t4-schema package.json.patch`; run it by hand after a `db reset`.
- A function that runs many times on a page must force custom plans (`set plan_cache_mode = 'force_custom_plan'`, as `recompute_page_text` does): PostgreSQL switches to a generic plan at the sixth call and the page-sized queries went from 2.5 ms to 145 ms.
