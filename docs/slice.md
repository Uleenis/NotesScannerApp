# Current slice

Slice 3 — Library.

Paths below are from the repository root.

- **Spec and plan:** `../../02 Design/Tranche 3.md`, one document, validated by the owner on 17/10/2026, with its four decisions as proposed.
- **Method:** `../../01 Steps/Méthode de travail.md`, revised on 16/10/2026. One session builds the four branches one after the other, each with its tests, reviews, PR and merge.
- **Next branch:** `t3/schema`.
- **Decisions from now on:** `../Tranche 3/Décisions.md`, in French, one line each; questions for the owner in its "Pour Tim" section.
- **Guarded file:** `supabase/config.toml` declares the new functions and their `verify_jwt` (`false` for the sweep, called by `pg_cron` with its secret, like `relaunch-page`). The owner approved it with the slice document; prepare it as a patch in `../Tranche 3/`, the PR that carries it is the owner's to merge, and the session goes on with the other branches meanwhile.
- **Local secret of the sweep:** passed like `relaunch-page`'s; the owner adds it to `supabase/functions/.env` and the local Vault following the steps the session writes in "Pour Tim". Until then the tests run with a test secret.
- **Gemini:** no real reading is needed; the tests replace Gemini.
- **After this slice:** the slices follow the order of `../../01 Steps/Périmètre du MVP.md`: 4, 7, 9, 5, 6, 8. When slice 3 is done, its last commit points this file to slice 4 if `../../02 Design/Tranche 4.md` says it is validated by the owner, with its branches in the table below. A slice whose document is missing or not validated: stop and ask.

## Branches

| # | Branch | Criteria | Sensitive | Merged by | State |
|---|---|---|---|---|---|
| 1 | `t3/schema` | 1, 5, 7 | yes (access rights) | Claude | to do |
| 2 | `t3/delete-move` | 2, 3, 4, 6, 9 | yes (access rights, files) | Claude, or the owner if it carries `config.toml` | to do |
| 3 | `t3/sweep` | 8 | yes (secret) | Claude, or the owner if it carries `config.toml` | to do |
| 4 | `t3/screens` | 10, 11, 12 | no | Claude | to do |

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
