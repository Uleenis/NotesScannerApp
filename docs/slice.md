# Current slice

Slice 6 — Capture, stopped after branch 2: criterion 14 on the paper pages is not held as written, but a repeat of 3 pages shows the 5-point limit is below the noise between two shots; the owner confirms the new limits (question 2 of `../Pour Tim.md`). Slices 1 to 5, 7 and 9 and Correctifs 1 and 2 are built; their Bilans are in `../Tranche N/Bilan.md`, `../Correctifs N/Bilan.md` and `../../05 Shipped/Tranche 1 - Lecture B1.md`.

Paths below are from the repository root.

- **Spec and plan of slice 6:** `../../02 Design/Tranche 6.md`, validated by the owner on 30/10/2026 with its six decisions as proposed.
- **Decisions:** `../Tranche 6/Décisions.md`, in French, one line each; questions for the owner in `../Pour Tim.md`.
- **Method:** `../../01 Steps/Méthode de travail.md`. One session per branch: "Continue la tranche." builds the next branch below to its merge, updates this file, and stops. Open the session with the model the table gives.
- **Next:** nothing until the owner confirms question 2 of `../Pour Tim.md` (keep the system scanner, 10 points per page, +0.5 outside math unchanged); then branch 3, with branches 4 to 6 after it. Repeat of Jour 19, 68 and 8, two more shots each: the spread between shots is 10.4, 0.9 and 7.3 points, so the noise of one shot exceeds 5 points on two of the three pages; Jour 68 is stable at about 5 points worse than the iPad scans. With the mean of the shots the journal is +0.21 (+0.80 without Jour 86, above 0.5) and everything outside math −1.95, held only by the fiches; these figures are optimistic (the three pages were chosen as the worst, the other 18 have one shot). The owner's yes also accepts that the global limit is held only through the fiches or Jour 86, and a 10-point limit set just above the observed noise. Branch 2 was measured twice (`../../04 Testing/T6 mesures/Résultats.md`). First on the iPad scans passed through the scanner by the gallery: not usable, those scans have no page edge to find and the corners cut the margin. Then, the measure that counts, on the 21 paper pages photographed by the scanner itself (corners as proposed): outside math the CER goes down 1.39 points against the iPad scans (limit +0.5), but only through the fiches, which that comparison cannot judge; the journal alone, the only comparable scope, is +0.92 (+1.54 without Jour 86), and 3 journal pages lose more than 5 points (Jour 19 +8.4, Jour 68 +5.7, Jour 8 +5.4). No cut text on the 4 images re-read (17 not checked); the probable cause is contrast, not proven, and the noise between two shots of one page was not yet measured at that point. Measure 15: lighting does not help on the paper pages either (+2.64 points), so branch 7 is not built. Measure 16: Laplacian variance of the grayscale image at 1,000 px, threshold 300, taken on the first set of scans (not redone; no paper photo has been measured for sharpness). If the owner keeps the system scanner, branches 3 to 6 follow with the limits set by the owner; branch 4 starts from the threshold above.
- **Order:** branches 1 to 7 in the order of the table. Branch 2 decides the rest: if criterion 14 fails (the crop costs A more than 0.5 point of CER outside math, or more than 5 points on one page), branches 3 to 7 wait for the owner's answer in `../Pour Tim.md`. Branch 7 exists only if measure 15 keeps the lighting correction.
- **After this slice:** 8, then the owner's design and the reading improvements, then pre-beta, then 11 (`../../01 Steps/Périmètre du MVP.md`). A slice whose document is missing or not validated: stop and ask.
- **Guarded files:** none expected. The tests mock the scanner; CI does not build the native app.
- **The owner's:** question 2 of `../Pour Tim.md`.
- **Android build:** JDK 17 and the Android SDK are under `%LOCALAPPDATA%` (no administrator rights, no permanent variable); the command is in `docs/architecture.md` (`modules/document-scanner/`). CMake 3.22.1, the SDK default, fails on this PC ("build.ninja still dirty"): `android/local.properties` points `cmake.dir` at 3.31.6, to write again after `expo prebuild --clean`.
- **Gemini:** no call in tests or measures. The phone checks read about six pages, two calls each.
- **Measures:** kits outside the repository, in `../../04 Testing/T6 mesures/`.

## Slice 6

| # | Branch | Criteria | Level | Session | Reviews | State |
|---|---|---|---|---|---|---|
| 1 | `t6/dev-build` (development client, local Android build, `scanPages`, measurement screen in development builds only) | 2, 10 | ordinary | Sonnet 5.5, High | code, Sonnet | done |
| 2 | `t6/measure` (crop, lighting, sharpness threshold, outside the repository) | 12 to 16 | ordinary | Sonnet 5.5, High | code, Sonnet | done, criterion 14 as written not held (journal +0.92 on one shot, 3 pages over 5 points); the repeat of 3 pages shows the noise; the owner confirms the limits |
| 3 | `t6/source` (`import` in `pages.source`, rights) | 1 | sensitive (access rights) | Sonnet 5.5, High | code and security, Sonnet | |
| 4 | `t6/sharpness` (sharpness function, synthetic fixtures, threshold of measure 16) | 7 | ordinary | Sonnet 5.5, High | code, Sonnet | |
| 5 | `t6/series` (capture screen, series, blurry pages, sending, limit, network loss, cache) | 2 and 10 on the screen, 3 to 6, 8, 11, 17, 18, 20 | sensitive (users' files) | Sonnet 5.5, High | code and security, Sonnet | |
| 6 | `t6/import` (multiple selection, review, bounds, unreadable files) | 3, 9, 10 on the screen, 11, 19 | sensitive (hostile input, users' files) | Sonnet 5.5, High | code and security, Sonnet | |
| 7 | `t6/lighting` (only if measure 15 keeps it) | 15 | ordinary | Sonnet 5.5, High | code, Sonnet | not built (measure 15) |

## Carried from branch 1 to branches 5 and 6

- Sweep `cache/scans/` (Android) and `tmp/scans/` (iOS) at the start of the app, like the `export-` folders: a page scanned before the app is killed stays there otherwise.
- `failed` from `scanPages` can also mean that ML Kit's module could not be fetched (Google Play services present, the scanner not downloaded): decide whether the capture screen then offers the import alone, like `unavailable`.
- The scanner promise is lost if Android kills the app while the scanner is open: the capture screen must not wait on it forever.
- iOS: VisionKit has no page limit, and the module keeps the first pages up to the limit, dropping the others without a word. Decide before the pre-beta (an error, or a message).
- Not seen yet on the phone: that the scanner's result reaches the module (`OnActivityResult`), and that ML Kit's copies are erased. Measure 12 shows the first.

## Still open from slice 5

- The owner's: question 1 of `../Pour Tim.md`.
- Cloud Run (pre-beta): deploy the reading service before the Edge Functions; an older service refuses the `user_id` of `/recognize` and pages are then read with B1 alone. The service needs a writable `/tmp`. The 64 MB personal model is above the 50 MB limit of the free plan in production.
- The service threshold of a personal model stays 0.129 on `ketos test` (the owner, 31/10/2026, `../Tranche 5/Décisions.md`); measure 17 passes (1.1 % on 9 lines), to review in beta with real models near the threshold.
- The trainer has not run a whole task on the real GPU; a long task needs the PC kept awake.

## Notes carried from slice 2

- Cloud Run (pre-beta slice): concurrency 1, a request timeout above `ARBITRATE_TIMEOUT_MS` (30 s), a maximum number of instances; `read-page` and the relaunch task must not retry a page answered `too_complex`; give espeak an exec-allowed folder (`READING_ESPEAK_DIR`) and set `ORT_DISABLE_TELEMETRY=1` (the image does); restrict the egress of the service to Supabase; measure again an arbitration near the NER bound (about 12 s on the PC).
- Cloud Run: a bad `READING_URL` or `READING_SECRET` in production reads every page with B1 alone, with one `reading_service_misconfigured` line per cold start; the deploy must check that A gets written.
- Cloud Run: a cancelled recognition goes on in the service and holds its one-page lock; concurrency and instance count settle it. One user can keep the four places of the service busy with re-readings: add a per-user bound before Cloud Run.
- The service key lives in the process that decodes photos, and ALTO files left behind are never swept: both are for the owner to decide before Cloud Run (`../Tranche 2/Décisions.md`).
- Reading loads `.safetensors` files only, through `kraken.models.load_safetensors`; never `load_models` nor `load_from_checkpoint`.
- `set-page-type` has no section in `supabase/config.toml`: `verify_jwt` defaults to true and the handler checks the token itself.
- After a `supabase db reset`, the app on the phone keeps a session for an anonymous account that no longer exists: clear the app's data (Expo Go until branch 1, then the development build) before using it on the local stack.
