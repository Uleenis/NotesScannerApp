# Current slice

Slice 6 — Capture, branches 1 to 6 done (branch 7 is not built: measure 15 does not keep it). Slices 1 to 7 and 9 and Correctifs 1 and 2 are built; their Bilans are in `../Tranche N/Bilan.md`, `../Correctifs N/Bilan.md` and `../../05 Shipped/Tranche 1 - Lecture B1.md`.

Paths below are from the repository root.

- **Spec and plan of slice 6:** `../../02 Design/Tranche 6.md`, validated by the owner on 30/10/2026 with its six decisions as proposed.
- **Decisions:** `../Tranche 6/Décisions.md`, in French, one line each; questions for the owner in `../Pour Tim.md`.
- **Method:** `../../01 Steps/Méthode de travail.md`. One session per branch: "Continue la tranche." builds the next branch below to its merge, updates this file, and stops. Open the session with the model the table gives.
- **Next:** nothing in slice 6. Branch 6 (`t6/import`) added `importer.ts` (the system photo picker of `expo-image-picker`, the closed case of a picked file: address, size, format from its first bytes, pixel bounds before any decode), the review one image at a time ("Rotate", "Remove") in `use-series.ts` (`candidates`, `accepted`, `reviewAt`), `checkImports`, `captureService.prepareImport`, `source = import` through `SendInput.source`, and `ImagePicker` in `sweepScans()`. The owner's phone checks (criteria 17 to 21, `../Tranche 6/Vérifications.md`) need a new development build (new native module). The next slice is 8.
- **Order:** branches 1 to 6 done; branch 7 is not built.
- **After this slice:** 8, then the owner's design and the reading improvements, then pre-beta, then 11 (`../../01 Steps/Périmètre du MVP.md`). A slice whose document is missing or not validated: stop and ask.
- **Guarded files:** none expected. The tests mock the scanner; CI does not build the native app.
- **The owner's:** nothing for this slice at the moment.
- **Android build:** JDK 17 and the Android SDK are under `%LOCALAPPDATA%` (no administrator rights, no permanent variable); the command is in `docs/architecture.md` (`modules/document-scanner/`). CMake 3.22.1, the SDK default, fails on this PC ("build.ninja still dirty"): `android/local.properties` points `cmake.dir` at 3.31.6, to write again after `expo prebuild --clean`.
- **Gemini:** no call in tests or measures. The phone checks read about six pages, two calls each.
- **Measures:** kits outside the repository, in `../../04 Testing/T6 mesures/`.

## Slice 6

| # | Branch | Criteria | Level | Session | Reviews | State |
|---|---|---|---|---|---|---|
| 1 | `t6/dev-build` (development client, local Android build, `scanPages`, measurement screen in development builds only) | 2, 10 | ordinary | Sonnet 5.5, High | code, Sonnet | done |
| 2 | `t6/measure` (crop, lighting, sharpness threshold, outside the repository) | 12 to 16 | ordinary | Sonnet 5.5, High | code, Sonnet | done; criterion 14 held with the limits confirmed by the owner (0.5 outside math, 10 points per page) |
| 3 | `t6/source` (`import` in `pages.source`, rights) | 1 | sensitive (access rights) | Sonnet 5.5, High | code and security, Sonnet | done |
| 4 | `t6/sharpness` (sharpness function, synthetic fixtures, threshold of measure 16) | 7 | ordinary | Sonnet 5.5, High | code, Sonnet | done; measure 16 redone on paper photographs, score and threshold changed (0.55) |
| 5 | `t6/series` (capture screen, series, blurry pages, sending, limit, network loss, cache) | 2 and 10 on the screen, 3 to 6, 8, 11, 17, 18, 20 | sensitive (users' files) | Sonnet 5.5, High | code and security, Sonnet | done; phone checks 17, 18, 20 and the threshold on the Samsung left to the owner |
| 6 | `t6/import` (multiple selection, review, bounds, unreadable files) | 3, 9, 10 on the screen, 11, 19 | sensitive (hostile input, users' files) | Sonnet 5.5, High | code and security, Sonnet | done; phone checks 19 to 21 left to the owner |
| 7 | `t6/lighting` (only if measure 15 keeps it) | 15 | ordinary | Sonnet 5.5, High | code, Sonnet | not built (measure 15) |

## Carried from branch 1 to branches 5 and 6

- Done in branch 5: the sweep of `cache/scans/` and `ImageManipulator/` at the start of the app (Android; the iOS `tmp/scans` folder is out of reach of `expo-file-system`, to clear in the native module before the pre-beta), `failed` offers the scan button again (branch 6 adds the import), the screen never waits on the scanner (Cancel is always there, a late result is erased).
- iOS: VisionKit has no page limit, and the module keeps the first pages up to the limit, dropping the others without a word. Decide before the pre-beta (an error, or a message).
- Not seen yet on the phone: that the scanner's result reaches the module (`OnActivityResult`), and that ML Kit's copies are erased. Measure 12 shows the first.

- Done in branch 6: the pixel count of an imported file is bounded before any decode (`importer.ts`, `jpegSize` with its own bounds), `failed` and `unavailable` offer the import, and `ImagePicker` is swept. To see on the phone: that the picker of Android returns `…/cache/ImagePicker/<name>.<ext>` addresses (otherwise every file is set aside), the memory of a 50 Mpx photo at the reduction (`IMPORT_PIXELS_MAX` can drop to about 30 Mpx), and whether `ImageManipulator` honours the EXIF orientation of a raw gallery JPEG (if not, "Rotate" fixes it). Criterion 18 on the phone also tries a blank page or a covered lens: a near-blank page with sensor noise may pass as sharp, which is harmless (the check only warns).

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
