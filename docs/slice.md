# Current slice

Slice 8 — Offline, branch 1 done. Slices 1 to 7 and 9 and Correctifs 1 and 2 are built; their Bilans are in `../Tranche N/Bilan.md`, `../Correctifs N/Bilan.md` and `../../05 Shipped/Tranche 1 - Lecture B1.md`. Slice 6 was checked on the phone by the owner on 01/11/2026, all as expected.

Paths below are from the repository root.

- **Spec and plan of slice 8:** `../../02 Design/Tranche 8.md`, validated by the owner on 31/10/2026 with its seven decisions as proposed.
- **Decisions:** `../Tranche 8/Décisions.md`, in French, one line each; questions for the owner in `../Pour Tim.md`.
- **Method:** `../../01 Steps/Méthode de travail.md`. One session per branch: "Continue la tranche." builds the next branch below to its merge, updates this file, and stops. Open the session with the model the table gives.
- **Next:** branch 2, `t8/sync` (sensitive: Sonnet 5.5, High). SQLCipher and AES-GCM exist in SDK 57 (branch 1), so branches 2 to 5 go on.
- **The store for branches 2 to 5:** `src/offline/store.ts` (`docs/architecture.md`, entry `src/offline/`). `openAccountStore(userId)` gives the database (schema 1: JSON `data` columns for what the server returns; change it by a new numbered migration) and the sealed photos of pages and of the queue; it can throw `key_unavailable`, `store_newer`, `cipher_missing`, `backup_exclusion_failed` or a database error without erasing anything: the caller falls back to the server and tries again at the next start or return to the foreground. `lostPending` (pages lost to an unreadable key or database) must be told to the user: branch 4 (the sentence is not written yet). `wipeAccountStore` and `closeAccountStores` are for branch 5, which also sweeps at start the folders of `Documents/offline/` that are not the signed-in account, with their keys. A clear photo for display goes through `src/offline/view.ts` only.
- **Order:** 1 to 5, in the order of the table.
- **After this slice:** the owner's design and the reading improvements, then pre-beta, then 11 (`../../01 Steps/Périmètre du MVP.md`). A slice whose document is missing or not validated: stop and ask.
- **Local database:** until the owner says his day-2 phone checks of `../Vérifications à faire.md` are done, it holds their data: no `supabase db reset` and no `npm run db:test:concurrency` (it needs a reset); CI runs them. Do not install a new build on the phone before then either.
- **Guarded files:** none expected. The tests mock the database, the secure store and the network; CI does not build the native app.
- **The owner's:** install the new development build (`expo-sqlite` with SQLCipher, `expo-crypto`, the iOS module `backup-exclusion`; built on 01/11/2026 from `t8/store` in `android/app/build/outputs/apk/debug/`, not installed yet) once the day-2 checks are done, and run the phone checks, the `adb` copy of criterion 20 included. Question 2 of `../Pour Tim.md` (the Android key on a locked phone).
- **Prebuild:** `npx expo prebuild` cannot empty `android/` here (another process holds the folder, EBUSY). Run it in a copy (`git ls-files -co --exclude-standard` of `app.json`, `package.json`, `tsconfig.json`, `metro.config.js`, `plugins`, `modules`, `assets`, `src`, with a junction to `node_modules`) and copy the `android/` it makes, then `local.properties` back; check `AndroidManifest.xml` (`allowBackup="false"`, `@xml/no_backup_extraction`).
- **pgTAP locally:** while the local database holds the owner's data, a few tests that count rows of the whole database fail (deletion refusals, readings, relaunch); CI runs them on a fresh database.
- **Android build:** JDK 17 is under `%LOCALAPPDATA%\Programs\jdk17-tmp\jdk-17.0.20.1+1`. The Android SDK was installed from the Claude app and lives in `C:\Users\timcu\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Android\Sdk`; `%LOCALAPPDATA%\Android\Sdk` does not exist outside the app. `android/local.properties` gives that path for `sdk.dir` and `cmake.dir` (CMake 3.31.6; 3.22.1 fails with "build.ninja still dirty"); write it again whenever `expo prebuild` recreates the folder. The command is in `docs/architecture.md` (`modules/document-scanner/`). Install with `adb install -r` over USB.
- **Gemini:** no call in tests. The phone checks read about five pages, two calls each.

## Slice 8

| # | Branch | Criteria | Level | Session | Reviews | State |
|---|---|---|---|---|---|---|
| 1 | `t8/store` (SQLCipher database, encrypted photos, key, backup exclusion, wipe; development build rebuilt) | 1, 2, 3, 20 | critical (secrets) | Opus 5.5, High | code, Sonnet; security, Opus | done |
| 2 | `t8/sync` (filling from the server, removals, photos kept at sending, download on Wi-Fi, 1 GB budget) | 4, 5 | sensitive (users' files) | Sonnet 5.5, High | code and security, Sonnet | next |
| 3 | `t8/read-offline` (screens from the database, "Offline" line, disabled actions) | 6, 7, 14, 15, 17, 22 | ordinary | Sonnet 5.5, High | code, Sonnet | |
| 4 | `t8/queue` (offline capture, limit, queue, sending, refusals, deleted notebook, waiting pages on screen) | 8 to 12, 14, 16, 19 | sensitive (users' files) | Sonnet 5.5, High | code and security, Sonnet | |
| 5 | `t8/accounts` (one database per account, confirmation, wipe on sign-out, account change and deletion) | 13, 18, 21 | critical (accounts) | Opus 5.5, High | code, Sonnet; security, Opus | |

## Still open from slice 6

- iOS (pre-beta): VisionKit has no page limit, and the module keeps the first pages up to the limit, dropping the others without a word: decide (an error, or a message). The `tmp/scans` folder is out of reach of `expo-file-system`: clear it in the native module. The app id `com.uleenis.notesscanner` becomes final at the first release.
- A near-blank page with sensor noise may pass the sharpness check as sharp, which is harmless (the check only warns).

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
- After a `supabase db reset`, the app on the phone keeps a session for an anonymous account that no longer exists: clear the app's data before using it on the local stack.
