# Current slice

Slice 5 — Entraînement, built (branches 1 to 10; branch 11 does not exist); measure 17 and the phone checks wait for the owner. Slices 1 to 4, 7 and 9 and Correctifs 1 and 2 are done; their Bilans are in `../Tranche N/Bilan.md`, `../Correctifs N/Bilan.md` and `../../05 Shipped/Tranche 1 - Lecture B1.md`.

Paths below are from the repository root.

- **Spec and plan of slice 5:** `../../02 Design/Tranche 5.md`, validated by the owner on 27/10/2026 with its eight decisions as proposed.
- **Decisions:** `../Tranche 5/Décisions.md`, in French, one line each; questions for the owner in `../Pour Tim.md`.
- **Method:** `../../01 Steps/Méthode de travail.md`. One session per branch: "Continue la tranche." builds the next branch below to its merge, updates this file, and stops. Open the session with the model the table gives.
- **Next:** none. Slice 5 is closed: measure 19 failed, so branch 10 was the last; `../Tranche 5/Bilan.md`, `../Tranche 5/Vérifications.md` and the status of `../../AGENTS.md` are written. A new session stops and asks which slice comes next (slices 6 and 8, pre-beta, slice 11).
- **Order:** branches 1 to 11 in the order of the table. Branch 11 exists only if measure 19 (branch 10) passes; otherwise branch 10 is the last. Criterion 20 (phone) is checked by the owner through `../Tranche 5/Vérifications.md`; measure 17 waits for the owner's photos (`../Pour Tim.md` action 7).
- **After this slice:** 6, 8, pre-beta, 11 (`../../01 Steps/Périmètre du MVP.md`). A slice whose document is missing or not validated: stop and ask.
- **Guarded files:** one patch for the slice, prepared in branch 5 (`../Tranche 5/trainer-guardrails.patch`, `../Pour Tim.md` action 7): `.claude/settings.json` denies reading `services/training/.env`, with its tests in `tests/guardrails.test.ts`. The training image is not built in CI: its logic lives in the package of the reading service, tested by `check.sh`.
- **The owner's:** the Resend key in the function secrets, local and production (branch 2); `TRAINING_SECRET` in `supabase/functions/.env` and `services/training/.env` (branch 5); checking that Docker sees the GPU (branch 5); applying the guarded-file patch; writing and photographing the writing test for measure 17 (branch 7).
- **Gemini:** no call in tests or measures, which replay the pinned readings of the spikes. The phone checks read a few pages, two calls each.
- **Measures:** kits outside the repository, in `../../04 Testing/T5 mesures/`.

## Slice 5

| # | Branch | Criteria | Level | Session | Reviews | State |
|---|---|---|---|---|---|---|
| 1 | `t5/consent` (birth year, country, table of ages, `consents`, rights) | 1, 2 | critical (consent of minors) | Opus 5.5, High | code Sonnet, security Opus | done, PR 89 |
| 2 | `t5/parent` (request and confirmation of the parent's consent, the e-mail) | 3 | critical (secret, e-mail to a third party) | Opus 5.5, High | code Sonnet, security Opus | done, PR 90 |
| 3 | `t5/consent-screens` (screens of age, consent, parent, withdrawal and erasure) | 4, 14 | sensitive (deletion) | Sonnet 5.5, High | code and security, Sonnet | done, PR 91 |
| 4 | `t5/writing-test` (texts, photos, check route, screen) | 5 | sensitive (users' files) | Sonnet 5.5, High | code and security, Sonnet | done, PR 92 |
| 5 | `t5/trainer` (image, jobs, three functions, harvest, training, replacement of the active model, sweep) | 6, 7, 8 | critical (secret, exposure of a service) | Opus 5.5, High | code Sonnet, security Opus | done, PR 93 |
| 6 | `t5/personal-reading` (reading with the personal model, rules tied to the model of A) | 9 | critical (loading a model) | Opus 5.5, High | code Sonnet, security Opus | done, PR 96 |
| 7 | `t5/measure` (measures 15 to 17, outside the repository) | 15, 16, 17 | ordinary | Sonnet 5.5, High | code, Sonnet | done, PR 97, measures 15 and 16 made, 17 waits for the owner's photos |
| 8 | `t5/levels` (level of a notebook, state in the account, export and deletion) | 10, 13, 14 | sensitive (users' files) | Sonnet 5.5, High | code and security, Sonnet | done, PR 98 |
| 9 | `t5/dates` (date check and its display, measure 18) | 11, 18 | ordinary | Sonnet 5.5, High | code, Sonnet | done, PR 99, measure 18 held |
| 10 | `t5/faults-measure` (measure 19, outside the repository) | 19 | ordinary | Sonnet 5.5, High | code, Sonnet | done, PR 100, measure 19 failed |
| 11 | `t5/faults` (fault notification, only if measure 19 passes) | 12, 14 | ordinary | Sonnet 5.5, High | code, Sonnet | not built, measure 19 failed |

## Notes carried from slice 5, branch 10

- Measure 19 (`04 Testing/T5 mesures/m19/`, `run.py`, results in `resultats.md`) failed. Rule played: A and B1 equal on their raw forms, not a proper noun (the NER label of B1, A or B2) and without a digit, not in `private.dictionary_words`, exactly one dictionary word at a Levenshtein distance of 1. On the 18 linear pages with the pinned chain, A and B1 write 3 of the 14 known fault positions (12 distinct words occur on these pages) as written, and 1 is notified with the right form (2 needed); 0 false notifications (3 allowed). The 24-line model and a run without the proper-noun gate give the same counts.
- Branch 11 does not exist: the fault notification is out of the MVP (decision 8 of the spec) and the question to reopen it after the beta, from the users' own corrections, is in `../Pour Tim.md`, question 3. Criterion 12 has no object. `fault_suggestion` was never created: no migration, table, string or screen of slice 5 refers to it.
- Still open for the owner: the two photos of measure 17, the phone checks of criterion 20, and questions 1 to 3 of `../Pour Tim.md`.

## Notes carried from slice 5, branch 9

- `t5/dates` adds `private.date_pair`, `private.date_flags`, `private.date_alerts_notebook`, `private.refresh_dates`, the queue `private.dates_pending` and its triggers (migration `20261108120000_t5_dates.sql`), the shown alert `date_incoherent` (`src/pages/alerts.ts`, `document-view.tsx`) and the refresh of a page's alerts after a correction or an edit; contract in `docs/architecture.md` ("Date check").
- Measure 18 (`04 Testing/T5 mesures/m18/`, `run.py gen`, the three queries through `supabase db query --local -f`, then `run.py check`; results in `resultats.md`): 15 of 15 wrong readings and the 3 alerts of `Jour 3` with the truth as reference; 3 of 3 and no right reading alerted on both `m36` passes with the cleaned read reference; SQL equal to Python on 1,500 offset lists and 4,000 headers. The kit has to be run again if `date_pair` or `date_flags` change.
- Branch 11 (faults, only if measure 19 passes): the recalculation of a notebook already runs on every change of its pages and level through `private.dates_pending`; fault suggestions can use the same queue and the lock `lexicon:<notebook id>`, and must delete and insert rows with `skip locked` as `refresh_dates` does.
- Set aside after review (PR 99): a page held by an operation that queues no recalculation can keep a stale alert state until the next change of the notebook; a header opened by a sign outside ASCII (`«Jour 5»`) or by exotic spaces gives no pair; a recalculation near 500 pairs costs about 0.7 s under the notebook's lock; the merge of a transfer, `edit_page` and `record_reading_a` are not run against the date alerts in pgTAP (the triggers sit on the tables they write).

## Notes carried from slice 5, branch 8

- `t5/levels` adds `private.has_model_in_service`, `set_correction_level` (server only), `training_stage()` (signed-in users) and the trigger `htr_models_reset_levels` (migration `20261107120000_t5_levels.sql`), the function `set-correction-level`, the menu item "Correction level" (`src/notebooks/use-level-item.ts`), the stage on `/training`, and `training.json` and the test photos in the export; contracts in `docs/architecture.md` ("Correction levels", `src/export/data/`).
- Branch 9 (dates): the alerts `date_incoherent` are shown only for notebooks at `journal`, and must be cleared when a notebook leaves `journal`; the level now also falls back to `course` when the active model leaves service, so the recalculation has to run on that change too (the trigger `htr_models_reset_levels` resets the level; clearing the alerts is branch 9's).
- Branch 11 (faults): "Grammaire" needs rules in service: use the same `private.model_in_service` through the model that read A (`readings.htr_model_id`), not the level alone.
- Set aside after review (PR 98): `htr_models` still gives `authenticated` a whole-table `select` (owner only, since slice 2; a column grant would hide the path and hash); the disk estimate of the data export ignores the two photos of a writing test; a failed training task leaves the stage "training" until the cadence makes another.

## Notes carried from slice 5, branch 7

- Measures in `04 Testing/T5 mesures/` (`Résultats.md`). 15: the criterion holds with the instrument of the Threshold Spike (12.5 % and 5.1 % against 12.9 % and 4.9 %) but not with `ketos test` (15.2 % and 6.5 %, 2.3 and 1.6 points above); the cause of the gap is not found. The service threshold stays 0.129 on `ketos test`, the cautious side; `../Pour Tim.md` question 2 proposes what to do after measure 17. 16: 239 fragments of 19 pages, all identical to the spike's. 17: kit ready, waits for the owner's two photos (`../Pour Tim.md` action 7); the Bilan of the slice reports it.
- `t5/measure` changed `personal.py`: a model trained by `ketos` has `seg_type` `bbox`, now accepted next to `baselines` (test in `test_personal.py`, contract in `docs/architecture.md`). Everything else of the check was met by a real model.
- The trainer's `ketos test` runs in the same environment as the trainings; a CUDA "unknown error" killed one training after the PC slept: a long task needs the PC kept awake.

## Notes carried from slice 5, branch 6

- `t5/personal-reading` adds `readings.htr_model_id` (foreign key on the model and the owner, set to null when the model is erased), `private.model_in_service(model, user)` and `p_model_id` of `record_reading_a` (migration `20261106120000_t5_personal_reading.sql`), `src/reading/personal.py` in the service, and the owner in the query of `/recognize`; contracts in `docs/architecture.md` (`services/reading/` paragraph, `record_reading_a`).
- Branch 7 (measures): a model trained by `ketos` must pass the architecture check of `personal.py` (`fits`: the metadata keys of the generic, codes of 1 to 4 labels). Read one page of the measure account through `/recognize` with the trained model active and check the log says `model=personal`, not `personal_model_unavailable reason=architecture`; if a key is missing from the allow-list, add it there with its test.
- Branch 8 (levels): "en service" already exists in the database as `private.model_in_service`; `check_correction_level` should use it (today it only asks for an `active` model). A notebook's level does not depend on the model of a page.
- Cloud Run (pre-beta): deploy the reading service before the Edge Functions; an older service refuses the `user_id` of `/recognize` and pages are then read with B1 alone. The service needs a writable `/tmp` (the models are written there for their check, then erased).
- Set aside after review (PR 96): the rule check lives in `record_reading_a`, not in a trigger on `page_tokens` (only the server writes there); a model is held twice in memory for a moment while it downloads (200 MB at most); the change of loader of the generic (`load_safetensors`) was not measured again with criterion 1 of slice 2 (the same Kraken loader read that file before).

## Notes carried from slice 5, branch 5

- `t5/trainer` adds `public.training_tasks`, `claim_training_task`, `training_upload_target`, `report_training_task`, `model_orphans`, `writing_test_orphans` and `htr_models.sha256`/`faults_correct` (migration `20261105120000_t5_trainer.sql`; `finish_writing_test` queues the first task, `revoke_training` deletes the tasks), the functions `training-claim`, `training-upload`, `training-report`, the sweep of `models` and of test photos in `sweep-alto`, the trainer (`harvest.py`, `training.py`, `trainer.py` in the reading package) and its image `services/training/`; contracts in `docs/architecture.md` ("Training", the sweep, the trainer paragraph of `services/reading/`).
- Branch 6 must bind the rules to the model that read A: today `gate_open` opens on any `active` personal model with `cer` at most 0.129, so once a model is trained locally the rules run on pages read by the generic model. Production has no trainer (no `TRAINING_SECRET`), so nothing changes there until then. Loading a personal model must use `checked_model` of `training.py` (a `.safetensors` file, not a link, header parsed, SHA-256 of `htr_models.sha256`).
- Branch 7 (measures): measure 15 uses the trainer's instrument (`ketos test` report, errors over characters); measure 16 compares `harvest.py` with the port, which adds that a word of B1 skipped by the reading cuts the run (the spec's "mot supprimé") and the corrections; on the Loop Spike pages, without corrections, only the first can differ. Not yet checked on the real GPU: the format of the `ketos test` report, `Recognizer(accelerator="gpu")`, the raw `PUT` to the signed upload address, `ketos` on a read-only root with `HOME=/tmp`, and a whole task within its 2-hour claim (harvest budget 40 minutes, training to 80 minutes).
- Branch 8: `training_tasks` gives the client nothing; the state "entraînement en cours" needs a column grant or a server answer. The export of "my data" lists `htr_models` without their files.
- For the owner (`../Pour Tim.md`): `TRAINING_SECRET` and the GPU check (action 6, an NVIDIA driver 580 or later for CUDA 13.0), the guarded patch (action 7), the 64 MB model against the 50 MB limit of the free plan in production (question 2), the `decode-uri-component` advisory allowed until the next Expo SDK (question 3).
- Set aside after review (PR 93): the trainer's CUDA libraries are installed without hashes (not in the lock); the race script fails the open tasks of other users of the local database first.

## Notes carried from slice 5, branch 4

- `t5/writing-test` adds `public.writing_tests` and `begin_writing_test`, `finish_writing_test`, `fail_writing_test` (migration `20261104120000_t5_writing_test.sql`; `revoke_training` replaced to delete the tests), `prepare-writing-test` and `check-writing-test`, the route `/check-writing` of the reading service (`writing_test.py`), the texts (two identical copies: `src/training/writing-test-texts.json` and `services/reading/src/reading/writing_test_texts.json`) and the screen `/training/writing-test`; contracts in `docs/architecture.md` ("Writing tests", `src/training/`, `services/reading/`).
- Branch 5 must extend `finish_writing_test` so that an accepted test creates the first training task (same transaction, same lock), and must make the nightly sweep also erase the folders `photos/{user_id}/writing-tests/{test_id}/` that no `writing_tests` row names after 24 hours (a signed upload address lives about two hours and can land a photo after a withdrawal or after a test expired; a test that expired and was never followed by another `prepare-writing-test` keeps its photos until then).
- The trainer gets the two photos of the accepted test and its template (`fr` or `en`) and must cut and align exactly as `writing_test.py` does: `template_lines`, `sheet_lines`, `read_lines`, `cut` and `cer` are the functions to reuse, with `MAX_CER` 0.6. A kept piece is a line of the photo with the piece of the text it covers; the text of the validation lines is the text as printed, faults included.
- A failure of the reading service during a check (network, timeout, `busy`, 5xx) marks the test `failed`, erases its photos and counts in the three tests of the day; set aside after review (the other choice leaves a test pending for 30 minutes) and for the owner to judge in beta.
- The check runs in the background after the 202, two sheets one after the other, each up to the 135 s of `/recognize`; like `read-page`, it depends on the wall clock of the Edge runtime for `waitUntil`. A check cut short leaves the test pending until `begin_writing_test` expires it after 30 minutes.

## Notes carried from slice 5, branch 3

- `t5/consent-screens` adds `revoke-training` and `public.revoke_training(uuid)` (migration `20261103120000_t5_revoke.sql`), the screens under `/training` (state and withdrawal, year of birth, consent, parent's e-mail, parent's code) and `src/training/`; contracts in `docs/architecture.md` ("Withdrawal of the consent", `src/training/`).
- `revoke_training` today deletes the consent, the request to a parent, the personal models (`htr_models`) and resets the notebooks to `course`. Branch 4 must extend it (new migration, with its pgTAP test) to delete the `writing_tests` rows, and `revoke-training`'s file erase already covers the folder `writing-tests` of `photos`. Branch 5 must extend it to delete the training tasks and make `training-report` refuse a report that arrives after the withdrawal (the part of criterion 4 this branch could not hold), with a parallel test.
- The client reads the state with the rights of the user (`profiles.birth_year`, the active `consents` row). Branch 8 builds the states of the account ("test à faire", "entraînement en cours", "en service") on top of `useTrainingState` (`src/training/queries.ts`); until then the state screen shows only who consented and the withdrawal.
- After the fifth wrong parent code the request is gone: the code screen says the code is no longer valid and offers to ask again.

## Notes carried from slice 5, branch 2

- `t5/parent` adds `request-parent-consent` and `confirm-parent-consent`, three `private` tables and the server functions `request_parent_consent`, `confirm_parent_consent`, `withdraw_parent_request` and `private.purge_parent_requests` (migration `20261102120000_t5_parent.sql`); contract in `docs/architecture.md` ("Parent consent").
- For the screens (branch 3): the request answers `{requested: true}` or `error` among `invalid_request`, `invalid_email`, `same_email`, `account_not_registered`, `age_missing`, `not_under_age`, `consent_already_active`, `send_limit` (429), `unavailable` (503, no Resend key) and `send_failed` (502). The confirmation answers `{confirmed: true}` or `wrong_code` with `attempts_left`, `code_expired`, `no_request` (also after the fifth wrong code), `invalid_request` and the consent refusals. The client cannot see a request in progress: keep "I have a code" reachable, and treat `no_request` as "ask again".
- The withdrawal (branch 3) must also delete the row of `private.parent_consent_requests` of the user, under the same advisory lock.
- Until the owner sets `RESEND_API_KEY` (`../Pour Tim.md`, action 5), the request answers `unavailable`; with Resend's sandbox sender, only the owner's address receives the e-mail. The sender `onboarding@resend.dev` is fixed in `_shared/parent-consent.ts` and changes with the pre-beta domain.

## Notes carried from slice 5, branch 1

- `t5/consent` adds `profiles.birth_year` and `profiles.country`, `private.digital_consent_ages` and `public.consents` (migration `20261101120000_t5_consent.sql`); contract in `docs/architecture.md` ("Age and consents"). The `parent` row is written by inserting into `consents` with `granted_by = 'parent'` and `parent_email`: the trigger already checks that the user is under the age, registered, on the current version and without an active consent, so `t5/parent` only adds the request, the code and the e-mail. The refusal to a parent address equal to the account's is `t5/parent`'s.
- The client learns that a parent must agree from the refusal `under_age` of its insert (branch 3). A withdrawal is an update of `revoked_at` alone, dated by the database, under the user's advisory lock (branch 3).
- The export of "my data" (branch 8) must add `birth_year` and `country` to `profile.json` along with the consents.
- Set aside after review: the country and the age are declared, and an account can be deleted and made again to declare another age; both go to the owner in `../Pour Tim.md` for the legal review.

## Notes carried from slice 2

- Cloud Run (pre-beta slice): concurrency 1, a request timeout above `ARBITRATE_TIMEOUT_MS` (30 s), a maximum number of instances; `read-page` and the relaunch task must not retry a page answered `too_complex`; give espeak an exec-allowed folder (`READING_ESPEAK_DIR`) and set `ORT_DISABLE_TELEMETRY=1` (the image does); restrict the egress of the service to Supabase; measure again an arbitration near the NER bound (about 12 s on the PC).
- Cloud Run: a bad `READING_URL` or `READING_SECRET` in production reads every page with B1 alone, with one `reading_service_misconfigured` line per cold start; the deploy must check that A gets written.
- Cloud Run: a cancelled recognition goes on in the service and holds its one-page lock; concurrency and instance count settle it. One user can keep the four places of the service busy with re-readings: add a per-user bound before Cloud Run.
- The service key lives in the process that decodes photos, and ALTO files left behind are never swept: both are for the owner to decide before Cloud Run (`../Tranche 2/Décisions.md`).
- Slice 5: retiring the active personal model leaves notebooks above `course` as they are, unless the withdrawal sets them back (spec of slice 5, "Retrait"). Reading loads `.safetensors` files only, through `kraken.models.load_safetensors`; never `load_models` nor `load_from_checkpoint`.
- `set-page-type` has no section in `supabase/config.toml`: `verify_jwt` defaults to true and the handler checks the token itself.
- After a `supabase db reset`, the phone's Expo Go keeps a session for an anonymous account that no longer exists: clear Expo Go's data for the project before using the app on the local stack.
