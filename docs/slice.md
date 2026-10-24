# Current slice

Slice 7 — Export et recherche is in progress (next branch: 4, `t7/search-screen`). Correctifs 1 and slice 4 are done.

Paths below are from the repository root.

- **Spec and plan:** `../../02 Design/Tranche 7.md`, one document, validated by the owner on 23/10/2026, with its decisions as proposed. Slice 7 adds `expo-print`, `expo-sharing` and a pure JavaScript ZIP library (check in Expo Go in the first branch that adds them); no guarded file; no Gemini call.
- **Method:** `../../01 Steps/Méthode de travail.md`, revised on 19/10/2026. One session per branch: "Continue la tranche." builds the next branch below to its merge, updates this file, and stops. Open the session with the model the table gives.
- **Correctifs 1:** spec and plan in `../../02 Design/Correctifs 1.md` (validated 23/10/2026), decisions in `../Correctifs 1/Décisions.md`. Pieces 1 (`fix/action-sheet`), 2 (`fix/keyboard`) and 3 (`fix/display`) are merged; its Bilan is `../Correctifs 1/Bilan.md`, its phone checks `../Correctifs 1/Vérifications.md`.
- **Next branch:** 4, `t7/search-screen` (Sonnet 5.5, High). The last branch of slice 7 writes `../Tranche 7/Bilan.md` and `../Tranche 7/Vérifications.md` and the status of `AGENTS.md`.
- **Slice 4 is done:** its seven branches are merged (PRs 58 to 62, 64 and the PR of `t4/edit`), its Bilan is `../Tranche 4/Bilan.md` and its decisions `../Tranche 4/Décisions.md`.
- **Decisions from now on:** `../Tranche 7/Décisions.md`, in French, one line each; questions for the owner in `../Pour Tim.md`.
- **Guarded files:** only the referee (`.claude/`, `.githooks/`, `.github/`, `scripts/`, the two guardrail tests, gitleaks). A slice that needs one prepares one patch and writes it in `../Pour Tim.md`.
- **Gemini:** no call in slice 7; measure 9 starts from the pinned readings. One real end-to-end reading costs two calls.
- **Slice 3 is done** (PRs 46, 49 to 53 and the PR of `t3/screens`): its Bilan is `../Tranche 3/Bilan.md`, its decisions `../Tranche 3/Décisions.md`, and the phone checks of slices 2 to 4 are in `../Vérifications 1.md`: done on 22/10/2026 for slices 2 and 4; slice 3 waits for its menus to work on Android (`../../09 Iteration Logs/Tranches 2 à 4.md`).
- **After this slice:** the slices follow the order of `../../01 Steps/Périmètre du MVP.md`: 9, 5, 6, 8. Cloud Run comes in the pre-beta slice (PB, after slice 8), with the paid accounts, the migrations and functions of slices 2 to 4, and Vertex AI; production stays at slice 1 until then (see the notes carried from slice 2). A slice whose document is missing or not validated: stop and ask.

## Branches

| # | Branch | Criteria | Level | Session | Reviews | State |
|---|---|---|---|---|---|---|
| 1 | `t7/search-db` (full-text index, two-rank search function, bounds, excerpts, rights) | 1, 2, 3 | sensitive (access rights) | Sonnet 5.5, High | code and security, Sonnet | done, PR 74 merged |
| 2 | `t7/lexicon` (dictionary, `lexicon_entries`, recomputation, account transfer, suggestion) | 2, 4, 5 | sensitive (access rights) | Sonnet 5.5, High | code and security, Sonnet | done, PR 77 |
| 3 | `t7/search-measure` (recall measure, outside the repository) | 9 | ordinary | Sonnet 5.5, High | code, Sonnet | done, PR 78 |
| 4 | `t7/search-screen` (search screen, page opened with the highlight box) | 8, 10 | ordinary | Sonnet 5.5, High | code, Sonnet | next |
| 5 | `t7/export` (PDF and Markdown of a page, a chapter, a notebook) | 6, 8, 11 | sensitive (hostile input in HTML) | Sonnet 5.5, High | code and security, Sonnet | to do |
| 6 | `t7/my-data` (export of "my data" on the phone) | 7, 8, 12 | sensitive (users' files) | Sonnet 5.5, High | code and security, Sonnet | to do |

## Slice 4

| # | Branch | Criteria | Level | Session | Merged by | State |
|---|---|---|---|---|---|---|
| 1 | `t4/schema` | 4, 5 | sensitive (access rights) | Sonnet, High | Claude | done, PR 58 merged |
| 2 | `t4/second-pass` | 1, 2 | sensitive (model call) | Sonnet, High | Claude | done, PR 59 merged |
| 3 | `t4/rules` | 3 | ordinary | Sonnet, High | Claude | done, PR 60 merged |
| 4 | `t4/replay` | 8, 9 | ordinary | Sonnet, High | Claude | done, PR 61 merged |
| 5 | `t4/math-check` | 10 | ordinary | Sonnet, High | Claude | done, PR 62 merged |
| 6 | `t4/correction` | 4, 7, 11 | ordinary | Sonnet, High | Claude | done, PR 64 merged |
| 7 | `t4/edit` | 6, 7, 11 | ordinary | Sonnet, High | Claude | done, PR to merge; last of the slice: Bilan and status of `AGENTS.md` written |

## Slice 3

Done: 4 branches, PRs 46, 50, 51, the PR of `t3/screens`, and outside the plan 49 (race test), 52 (`config.toml`, merged by the owner) and 53 (purge of the cron history). What it does and what is left for the owner are in `../Tranche 3/Bilan.md`. Nothing waits for the owner on a guarded file. The migrations of the slice (`20261020120000_t3_schema.sql`, `20261021120000_t3_delete_notebook_pages.sql`, `20261022120000_t3_sweep.sql`, `20261023120000_t3_purge_cron_history.sql`) and the sweep secret go to production later, the owner's.

## Slice 2

Done: 13 branches, PRs 24, 27 to 31 and 38 to 43, and the PR of branch 12; what it does, its measures and what is left for the owner are in `../Tranche 2/Bilan.md`, its decisions in `../Tranche 2/Décisions.md`. Branch 12 (`t2/formulas`) changes `package.json` and is the owner's to merge. The phone checks of slice 2 wait for the owner's return.

## Notes carried from slice 2

- Cloud Run (pre-beta slice): concurrency 1, a request timeout above `ARBITRATE_TIMEOUT_MS` (30 s), a maximum number of instances; `read-page` and the relaunch task must not retry a page answered `too_complex`; give espeak an exec-allowed folder (`READING_ESPEAK_DIR`) and set `ORT_DISABLE_TELEMETRY=1` (the image does); restrict the egress of the service to Supabase; measure again an arbitration near the NER bound (about 12 s on the PC).
- Cloud Run: a bad `READING_URL` or `READING_SECRET` in production reads every page with B1 alone, with one `reading_service_misconfigured` line per cold start; the deploy must check that A gets written.
- Cloud Run: a cancelled recognition goes on in the service and holds its one-page lock; concurrency and instance count settle it. One user can keep the four places of the service busy with re-readings: add a per-user bound before Cloud Run ("Pour Tim" of slice 2).
- Production follows `main`: `.github/workflows/deploy.yml` pushes the migrations before it deploys the functions, after every green run of Checks.
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
- `set_page_math` erases the corrections with the positions: `t4/correction` should ask for a confirmation before the switch when the page has corrections ("Pour Tim" of slice 4). The `math_incomplete` alert is erased on math to text (`t4/math-check`).
- A function that runs many times on a page must force custom plans (`set plan_cache_mode = 'force_custom_plan'`, as `recompute_page_text` does): PostgreSQL switches to a generic plan at the sixth call and the page-sized queries went from 2.5 ms to 145 ms.

## Notes carried from slice 4, branch 2

- `t4/second-pass` adds B2 (`_shared/reading-b2.ts`, `_shared/gemini-pass.ts`): a second Gemini call started with B1 after the claim, never charged, written to `readings` (`label = B2`) in the background once B1 is stored and the page is `text` or `math`; `/arbitrate` takes an optional `b2` (the service keeps it in `Arbitration.b2`, nothing reads it yet). `t4/rules` must read `arbitration.b2`: align it with `b2_content_map`, write `reading_b2`, `b1_start` and `b1_end` in the token objects sent to `record_reading_a`.
- `set-page-type` (math to text) called `/arbitrate` without `b2`: done in `t4/rules`.
- The fakes of the Deno tests: `world.pushSecond(...)` queues B2 outcomes (`"hold"` and `releaseSecond` hold one), `world.expireWaits` ends the wait for B2 at once, `world.waits` records it; the calls are `gemini_b2` and `insertReadingB2`.
- The `app` check failed on `main` after PR 58 (21/10/2026) and on PR 59: the first test of `capture-screen.test.tsx` exceeded the 5 s default on the CI runner, and a slow run cascaded to 129 failures in `page-screen.test.tsx`. Both suites now set `jest.setTimeout(30_000)` (`jest.config` is guarded, so the timeout lives in the two test files).

## Notes carried from slice 4, branch 3

- `t4/rules` makes the service decide with B2: `second.py` ranges B2 by content (`b2_content_map`, `align_global`), `rules.py` has rules 5, 6 and 7 in the order 2, 5, 3, 4, 6, 7, 8, 9, 10, `arbiter.py` writes `reading_b2`, `b1_start` and `b1_end` (raw characters of B1, `raw_spans`) gate open or not, and the `missing_line` alert through the new `p_alerts` of `record_reading_a` (migration `20261025120000_t4_rules.sql`, the owner's for production). `set-page-type` hands the stored B2 to `/arbitrate`.
- For `t4/replay`: `python -m reading.replay` takes an optional `b2` and `entities.b2` per page and returns `reading_b2`; it does not compute the alert. The forms keep their case (the spike lowercased them), and a missing line is one with no paired word whose run of words is nowhere in the other pass (the spike's harness fed rule 7 every unpaired line): if criterion 8 differs on a page, look there first, and write it in `../Tranche 4/Décisions.md`. Pairing matches the spike on 399 random pages and 52 stored pairs of real readings; criteria 8 and 9 are not measured yet.
- The alert is written gate closed too (`../Tranche 4/Décisions.md`, "Pour Tim"). `t4/math-check` writes `math_incomplete` the same way through `p_alerts` after widening the kinds `record_reading_a` accepts, or through its own path.
- Checked live on the local stack: the arbiter with the real store, espeak and the NER wrote the expected positions, places, rules 5 and 7 and the alert; the Edge Function path `set-page-type` is tested with fakes only.

## Notes carried from slice 4, branch 4

- `t4/replay` changes no code of the repository: the measure is the kit `04 Testing/T4 mesures/replay/` (`sh run.sh`, results in `Résultats.md`), outside the repository. Criterion 8: 18 pages, 1,819 positions, 0 differences against the harness reduced to rules 2 to 10 with B2 pinned. Criterion 9: 88 readings of the 11 free pages (V1, passes `lay` and `lay-swap`, four folds), 10,800 positions, 8 differences, all rule 7 in the harness and rule 9 in the service, on one line of `La France`; the harness gave rule 7 to every B1 line without a partner, the service only to a line whose words are nowhere in B2 (the spec of branch 3). With that definition on the harness side (`--refined`), 0 differences on both. Written in `../Tranche 4/Décisions.md`.
- NER labels are pinned (those of `camembert-ner`); the NER of the service was measured on its own in slice 2. The `missing_line` alert is not replayed (`reading.replay` computes rules only).

## Notes carried from slice 4, branch 5

- `t4/math-check` adds the completeness check of a page of math: `_shared/math-check.ts` (port of the unit of `Math Spike/scripts/units.py`, with two measured differences written in `../Tranche 4/Décisions.md`: the exponent or index in braces of one to three characters, and statements with no letter, digit or empty set), `checkMathPage` (called in the background after B2 is written in `reading-b2.ts`, and by `set-page-type` after a switch to math), and the migration `20261026120000_t4_math_check.sql`: `math_check_readings` and `record_math_alert` (server only) and `set_page_text` recreated to erase the `math_incomplete` alert. The alert holds two counts, `only_b1` and `only_b2`, and no text. The migration goes to production with the others of slices 2 to 4 in the pre-beta slice, the owner's.
- Criterion 10 is measured by the kit `04 Testing/T4 mesures/math-check/` (`python run.py`, outside the repository): 0 alerts on the 20 ordered pairs of the production passes, an alert in both directions between `t0-pass-3` and each of the 17 other passes, 0 alerts on the 272 pairs of the 17 others. The fidelity fixture of the port is `supabase/functions/tests/fixtures/math-units.json` (synthetic lines; `fixture.py` in the kit writes it from `units.py`).
- Every B2 written now costs one more read of the database (`mathCheckReadings`), on text pages too, to close the race with a switch to math: the order test of `read-page.test.ts` counts it.
- `t4/edit` shows the alerts next to the title (`missing_line` and `math_incomplete`); the app reads `page_alerts` through its own select policy.

## Notes carried from slice 4, branch 6

- `t4/correction` makes the words of a page of text tappable: `src/pages/words.ts` (reads `page_tokens` and `corrections` by 1,000 rows, `placeWords`, `suggestionsFor`, `isWord`, `addCorrection`), `displayPieces` in `display.ts` (title and blocks as pieces that know their place in the text), `piece-text.tsx` and `word-editor.tsx`, `usePageWords` and `useCorrectWord`. No migration, no function, no guarded file.
- `t4/edit` must keep `placeWords` honest: it checks the shown text against the places, so text the user adds or changes outside the positions (the planned own place for the user's text) makes the whole page not tappable unless the placement learns about it. The fixture `tests/fixtures/word-places.json` was written from the real `recompute_page_text` (kit in the session scratchpad, not kept): regenerate it the same way if that function changes.
- The mode "Modifier" can reuse `displayPieces` and `placeWords`; the alerts (`missing_line`, `math_incomplete`) are read by the app through its own select policy on `page_alerts`, next to the title.
- The phone check (criterion 11) must look at: the correction bar above the keyboard (header height under `KeyboardAvoidingView`), the tapped word staying visible, and VoiceOver reaching a word (nested `Text` in a selectable `Text`).
- `pageService` gained `words` and `correct`: every test that mocks it by hand lists them.

## Notes carried from slice 4, branch 7

- `t4/edit` adds the "Modifier" mode and the alerts next to the title. Migration `20261027120000_t4_edit.sql`: `page_gaps` (the text of the user between the words: gap `n` comes before the position of rank `n`, the last after the last position, and a page of math has its whole text in gap 0), `edit_page` (server only), a new `recompute_page_text` that takes a gap when there is one, empty corrections written by the server only (a deleted word), gaps erased by `set_page_math` and `set_page_text`, gaps moved by `transfer_account_rows`. Edge Function `edit-page` (no `config.toml` section: the default `verify_jwt` is true; optional patch `../Tranche 4/t4-edit config.toml.patch`). Client: `src/pages/edit.ts` (`alignEdit`, `editPage`), `alerts.ts`, `use-text-edit.ts`, `words.ts` reads `page_gaps` and `placeWords` takes them, `page-text-edit.tsx`.
- `PageWords` has a third list, `gaps`; every test that mocks `pageService` by hand lists `edit` and `alerts` as well as `words` and `correct`.
- `edit-race.sh` is in `db:test:concurrency` only once the owner applies `../Tranche 4/t4-schema package.json.patch` (it now adds `corrections-race.sh` and `edit-race.sh`); run both by hand after a `db reset`.
- The migrations of slice 4 (`20261024120000_t4_schema.sql`, `20261025120000_t4_rules.sql`, `20261026120000_t4_math_check.sql`, `20261027120000_t4_edit.sql`) go to production with those of slices 2 and 3 in the pre-beta slice, the owner's; deploy `read-page`, `relaunch-page`, `set-page-type` and `edit-page` only after them.
- Not on the phone yet: criterion 11 (keyboard bars, VoiceOver, English then French). The points to look at are in `../Tranche 4/Décisions.md`.

## Notes carried from slice 7, branch 1

- `t7/search-db` (migration `20261028120000_t7_search.sql`) adds the extension `unaccent`, the text search configuration `public.search_simple`, three full-text indexes and `public.search_pages(p_query, p_notebook_id)` (the one function of `public` besides `my_page_allowance` that `authenticated` may run). Its contract (bounds, ranks, columns) is in `docs/architecture.md`. It returns `token_index` for the frame, `excerpt`, `match_start` and `match_end` (in code points, `match_end` excluded) and `also_read`; the label « lu aussi : » and the bold are the screen's (branch 4), which converts the offsets to UTF-16. Refusals are `22023` with `query_too_long` or `query_too_many_words`.
- For `t7/lexicon`: the suggestion is a second function over `lexicon_entries` and `pg_trgm`; the dictionary is loaded by a migration. `search_pages` is not involved in the lexicon recomputation.
- The migration goes to production with the others (the deploy workflow), and `unaccent` must be allowed there.

## Notes carried from Correctifs 1, piece 1

- `fix/action-sheet`: `showMenu` publishes to a store in `src/lib/action-menu.ts` and `ActionSheetHost` (`src/components/action-sheet-host.tsx`, mounted in `_layout.tsx` after the Stack) draws the sheet as an absolute overlay, not a `Modal`. It closes on Cancel, a touch outside, the back button of Android and a change of route, and dismisses the keyboard when it opens. `ActionSheetIOS` is no longer used. No migration, function or guarded file.
- Set aside after review: TalkBack can still reach the screen under the sheet (`accessibilityViewIsModal` is iOS only); the sheet closes on a change of path, not of params. To look at on the Samsung (criterion 8): the keyboard and TalkBack.

## Notes carried from Correctifs 1, piece 2

- `fix/keyboard`: `KeyboardLift` (`src/components/keyboard-lift.tsx`) replaces the `KeyboardAvoidingView` of `document-view.tsx`. On a keyboard event it measures itself in the window and pads by the part of the keyboard that covers it (so no header height is needed), and by the bottom inset of the system bar when the keyboard is closed. The page scrolls so that the touched word (by the position of the touch, not the block) stays above the bar and the keyboard; in "Modifier" the field fills the screen and scrolls itself to the cursor. No dependency, no migration, no function, no guarded file.
- Not checked on a device (criterion 9): the lift under Expo Go on the Samsung, French then English; the tapped line staying visible; the bar clear of the gesture bar once the keyboard is closed.

## Notes carried from Correctifs 1, piece 3

- `fix/display`: `cleanView` (`src/pages/clean.ts`) is the one place that cleans a page of text for display: it removes `<u>` and `</u>`, and a blank line of B1 between two lines unless B2 (`readSecond` in `src/pages/second.ts`, `pageService.second`, `usePageSecond`) has a blank line between the matching lines. It returns a text and the words moved into it; the stored text, readings and positions never change. The words made by the tags (the tokenizer reads the `u` of `<u>` as a word) are left out of the tappable words. The Edit mode starts from the cleaned text, writes nothing while it is unchanged, and stores exactly what the user typed otherwise. No migration, function or guarded file.
- Every test that mocks `pageService` by hand lists `second` as well as `alerts`. Gap blocks of a page of text carry `testID="page-gap"`.
- The rule is skipped for a page of math, a page whose text was edited (gaps), and above 1,000,000 pairs of lines. The tags of `export` (slice 7) and the rich rendering (slice 9) should reuse `cleanView` / `stripUnderline`.
- Measure 7 (kit `04 Testing/C1 mesures/`): 28 extra blank lines removed, 7 real breaks lost.
- Not checked on a device (criteria 8 to 10): `../Correctifs 1/Vérifications.md`.

## Notes carried from slice 7, branch 2

- `t7/lexicon` (migrations `20261029120000_t7_dictionary.sql` and `20261029130000_t7_lexicon.sql`) adds `private.dictionary_words`, `public.lexicon_entries`, `private.lexicon_notebook` (the full recomputation, which is the definition of a lexicon) and `public.suggest_words(query, notebook)` returning `(word, suggestion)`, where `word` is the query word lowercased without accents: the search screen (branch 4) finds the word to replace by normalising the same way. Details in `docs/architecture.md` and `../Tranche 7/Décisions.md`.
- Lock order: the recomputation runs at the end of the operation under `lexicon:<notebook id>` and takes a key-share lock on the notebook row; any new function that locks a notebook row must use `for no key update`.
- Branch 3 (recall measure): the lexicon needs no part of it. Known parser limits from branch 1 still apply.
- Branch 4: `suggest_words` accepts the same bounds as `search_pages` (`22023` for `query_too_long` and `query_too_many_words`); the lexicon is empty for a notebook with fewer than two pages that carry a form.

## Notes carried from slice 7, branch 3

- `t7/search-measure` changes nothing in the repository but this file: criterion 9 is the kit `04 Testing/T7 mesures/recall/` (`sh run.sh`, results in `Résultats.md`), outside the repository. On the 18 linear pages, loaded into the local stack through `record_reading_a` from the pinned readings, 68 of the 100 wrong words of the shown text are found by searching the right word (34 at rank 1, 34 at rank 2); an independent oracle in Python gives the same 68, word by word: the index loses nothing. 53 of the 100 have the right word in a competing reading of their own position; the other 15 are found because the page carries the word elsewhere, so the literal equality of the criterion (68 against 53) is not met and is read as "every word carried by its position is found, and the found words are exactly those the page carries" (`../Pour Tim.md`). 11 of the 100 differ from the truth only by accent, case or apostrophe; without them 60 of 89 are found and 45 carried by their position.
- For branch 4: the search finds a page, not a position. For a hit carried by the position itself at rank 2, `token_index` is that position in 31 of 32 cases (the exception is a word that the page carries at two positions: the function returns the first). 13 of the 100 wrong words are found at rank 1 only because the page already writes the right word elsewhere.
