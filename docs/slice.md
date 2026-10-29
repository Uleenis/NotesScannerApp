# Current slice

Slice 5 — Entraînement. Slices 1 to 4, 7 and 9 and Correctifs 1 and 2 are done; their Bilans are in `../Tranche N/Bilan.md`, `../Correctifs N/Bilan.md` and `../../05 Shipped/Tranche 1 - Lecture B1.md`.

Paths below are from the repository root.

- **Spec and plan of slice 5:** `../../02 Design/Tranche 5.md`, validated by the owner on 27/10/2026 with its eight decisions as proposed.
- **Decisions:** `../Tranche 5/Décisions.md`, in French, one line each; questions for the owner in `../Pour Tim.md`.
- **Method:** `../../01 Steps/Méthode de travail.md`. One session per branch: "Continue la tranche." builds the next branch below to its merge, updates this file, and stops. Open the session with the model the table gives.
- **Next:** branch 4, `t5/writing-test`.
- **Order:** branches 1 to 11 in the order of the table. Branch 11 exists only if measure 19 (branch 10) passes; otherwise branch 10 is the last. Criterion 20 (phone) is checked after the last branch, through `../Tranche 5/Vérifications.md`. The last session writes `../Tranche 5/Bilan.md` and `../Tranche 5/Vérifications.md` and the status of `../../AGENTS.md`.
- **After this slice:** 6, 8, pre-beta, 11 (`../../01 Steps/Périmètre du MVP.md`). A slice whose document is missing or not validated: stop and ask.
- **Guarded files:** one patch for the slice, prepared in branch 5: `.claude/settings.json` denies reading `services/training/.env`, with its test in `tests/guardrails.test.ts`. It goes in `../Pour Tim.md`. The training image is not built in CI: its logic lives in the package of the reading service, tested by `check.sh`.
- **The owner's:** the Resend key in the function secrets, local and production (branch 2); `TRAINING_SECRET` in `supabase/functions/.env` and `services/training/.env` (branch 5); checking that Docker sees the GPU (branch 5); applying the guarded-file patch; writing and photographing the writing test for measure 17 (branch 7).
- **Gemini:** no call in tests or measures, which replay the pinned readings of the spikes. The phone checks read a few pages, two calls each.
- **Measures:** kits outside the repository, in `../../04 Testing/T5 mesures/`.

## Slice 5

| # | Branch | Criteria | Level | Session | Reviews | State |
|---|---|---|---|---|---|---|
| 1 | `t5/consent` (birth year, country, table of ages, `consents`, rights) | 1, 2 | critical (consent of minors) | Opus 5.5, High | code Sonnet, security Opus | done, PR 89 |
| 2 | `t5/parent` (request and confirmation of the parent's consent, the e-mail) | 3 | critical (secret, e-mail to a third party) | Opus 5.5, High | code Sonnet, security Opus | done, PR 90 |
| 3 | `t5/consent-screens` (screens of age, consent, parent, withdrawal and erasure) | 4, 14 | sensitive (deletion) | Sonnet 5.5, High | code and security, Sonnet | done, PR 91 |
| 4 | `t5/writing-test` (texts, photos, check route, screen) | 5 | sensitive (users' files) | Sonnet 5.5, High | code and security, Sonnet | next |
| 5 | `t5/trainer` (image, jobs, three functions, harvest, training, replacement of the active model, sweep) | 6, 7, 8 | critical (secret, exposure of a service) | Opus 5.5, High | code Sonnet, security Opus | |
| 6 | `t5/personal-reading` (reading with the personal model, rules tied to the model of A) | 9 | critical (loading a model) | Opus 5.5, High | code Sonnet, security Opus | |
| 7 | `t5/measure` (measures 15 to 17, outside the repository) | 15, 16, 17 | ordinary | Sonnet 5.5, High | code, Sonnet | |
| 8 | `t5/levels` (level of a notebook, state in the account, export and deletion) | 10, 13, 14 | sensitive (users' files) | Sonnet 5.5, High | code and security, Sonnet | |
| 9 | `t5/dates` (date check and its display, measure 18) | 11, 18 | ordinary | Sonnet 5.5, High | code, Sonnet | |
| 10 | `t5/faults-measure` (measure 19, outside the repository) | 19 | ordinary | Sonnet 5.5, High | code, Sonnet | |
| 11 | `t5/faults` (fault notification, only if measure 19 passes) | 12, 14 | ordinary | Sonnet 5.5, High | code, Sonnet | |

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
- Slice 5: retiring the active personal model leaves notebooks above `course` as they are, unless the withdrawal sets them back (spec of slice 5, "Retrait"). Reading loads `.safetensors` files only, through `kraken.models.load_models`; never `load_from_checkpoint`.
- `set-page-type` has no section in `supabase/config.toml`: `verify_jwt` defaults to true and the handler checks the token itself.
- After a `supabase db reset`, the phone's Expo Go keeps a session for an anonymous account that no longer exists: clear Expo Go's data for the project before using the app on the local stack.
