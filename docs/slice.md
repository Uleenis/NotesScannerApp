# Current slice

Slice 3 — Library.

Paths below are from the repository root.

- **Spec and plan:** `../../02 Design/Tranche 3.md`, one document, validated by the owner on 17/10/2026, with its four decisions as proposed.
- **Method:** `../../01 Steps/Méthode de travail.md`, revised on 19/10/2026. One session per branch: "Continue la tranche." builds the next branch below to its merge, updates this file, and stops. Open the session with the model the table gives.
- **Next branch:** `t3/delete-move`.
- **Decisions from now on:** `../Tranche 3/Décisions.md`, in French, one line each; questions for the owner in its "Pour Tim" section.
- **Guarded file:** `supabase/config.toml` declares the new functions and their `verify_jwt` (`false` for the sweep, called by `pg_cron` with its secret, like `relaunch-page`). The owner approved it with the slice document. The branch that needs it prepares the change as a patch in `../Tranche 3/`; its PR is then the owner's to merge: its session says so, marks the branch "waiting for the owner" below, and stops. The next session may build the next branch meanwhile, from `main`, if that branch does not need the waiting one.
- **Local secret of the sweep:** passed like `relaunch-page`'s; the owner adds it to `supabase/functions/.env` and the local Vault following the steps the session writes in "Pour Tim". Until then the tests run with a test secret.
- **Gemini:** no real reading is needed; the tests replace Gemini.
- **After this slice:** the slices follow the order of `../../01 Steps/Périmètre du MVP.md`: 4, 7, 9, 5, 6, 8. When slice 3 is done, its last commit points this file to slice 4 if `../../02 Design/Tranche 4.md` says it is validated by the owner, with its branches in the table below. A slice whose document is missing or not validated: stop and ask.

## Branches

| # | Branch | Criteria | Level | Session | Merged by | State |
|---|---|---|---|---|---|---|
| 1 | `t3/schema` | 1, 5, 7 | sensitive (access rights) | Sonnet, High | Claude | done: PR open, merged by `node scripts/merge-pr.mjs` once CI is green (the CI `reading` job needs the aiohttp fix first, see the notes) |
| 2 | `t3/delete-move` | 2, 3, 4, 6, 9 | sensitive (access rights, files, deletion) | Sonnet, High | Claude, or the owner if it carries `config.toml` | to do |
| 3 | `t3/sweep` | 8 | critical (secret) | Opus, High | Claude, or the owner if it carries `config.toml` | to do |
| 4 | `t3/screens` | 10, 11, 12 | ordinary | Sonnet, High | Claude | to do; last of the slice: its session also writes the Bilan (naming any branch still waiting for the owner), the status of `AGENTS.md` and `../Vérifications 1.md` (slice 3 is the third) |

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
- `library-race.sh` is not yet in `db:test:concurrency`: the patch for `package.json` is in `../Tranche 3/` and waits for the owner.
- The CI job `reading` fails on `main` since a new advisory on `aiohttp` 3.14.3 (fixed in 3.14.4): a separate branch bumps it before this PR can merge.
