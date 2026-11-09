# Current slice

None. Slices 1 to 9 and Correctifs 1 and 2 are built, merged and checked on the owner's phone; their documents are archived outside the vault, and the code and `docs/architecture.md` are the reference.

Paths below are from the repository root.

- **Next:** the owner's design and the reading improvements, then pre-beta, then 11 (`../../01 Steps/Périmètre du MVP.md`). No document exists yet for any of them: stop and ask.
- **Method:** `../../01 Steps/Méthode de travail.md`. A new slice adds its document in `../../02 Design/`, its decisions in `../Tranche N/Décisions.md`, and its branches in a table here.
- **Open work:** defects and features left open in `../../09 Iteration Logs/À améliorer.md`; the owner's actions in `../Pour Tim.md` (action 6: measure on the phone the offline restart with an expired session, fixed by PR 122).
- **Prebuild:** `npx expo prebuild` cannot empty `android/` here (another process holds the folder, EBUSY). Run it in a copy (`git ls-files -co --exclude-standard` of `app.json`, `package.json`, `tsconfig.json`, `metro.config.js`, `plugins`, `modules`, `assets`, `src`, with a junction to `node_modules`) and copy the `android/` it makes, then `local.properties` back; check `AndroidManifest.xml` (`allowBackup="false"`, `@xml/no_backup_extraction`).
- **Android build:** JDK 17 is under `%LOCALAPPDATA%\Programs\jdk17-tmp\jdk-17.0.20.1+1`. The Android SDK was installed from the Claude app and lives in `C:\Users\timcu\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Android\Sdk`; `%LOCALAPPDATA%\Android\Sdk` does not exist outside the app. `android/local.properties` gives that path for `sdk.dir` and `cmake.dir` (CMake 3.31.6; 3.22.1 fails with "build.ninja still dirty"); write it again whenever `expo prebuild` recreates the folder. The command is in `docs/architecture.md` (`modules/document-scanner/`). Install with `adb install -r` over USB.
- **pgTAP locally:** while the local database holds the owner's data, a few tests that count rows of the whole database fail (deletion refusals, readings, relaunch); CI runs them on a fresh database.
- **Supabase client of the Edge Functions:** pinned at exactly 2.118.0, the version of the app, as `deno.lock` is not tracked. Move it on purpose: 2.119.0 makes `auth.admin.deleteUser` read the user first (two calls, one more failure path for `delete-account`, and the test `deleting the account` counts one).
- **Gemini:** no call in tests. The free key allows about 20 calls a day and a page costs two.

## Set aside in slice 8

- Pages taken between the confirmation and the switch of account are not counted again; the account screen of a provisional account shows an empty e-mail row; an auth server answering 502 to 504 counts as a network failure for the provisional account.
- The photo of a page that could not enter the queue is erased after it is told; a send that times out after 120 s keeps running while the run goes on; offline, the capture falls back to the first notebook when no route parameter is given; the queue is sent before the synchronisation starts; the known limit is not corrected after a send until the next online reading; a sealed file can remain if the app is killed between its save and its row; the waiting screen redirects to the library when its page is sent.
- When the store opens knowing nothing (never synchronised), an offline start still waits for the retries of the Supabase libraries.
- The offline key stays readable on a locked Android phone until pre-beta (the owner, 02/11/2026).

## Still open from slice 6

- iOS (pre-beta): VisionKit has no page limit, and the module keeps the first pages up to the limit, dropping the others without a word: decide (an error, or a message). The `tmp/scans` folder is out of reach of `expo-file-system`: clear it in the native module. The app id `com.uleenis.notesscanner` becomes final at the first release.
- A near-blank page with sensor noise may pass the sharpness check as sharp, which is harmless (the check only warns).

## Still open from slice 5

- Cloud Run (pre-beta): deploy the reading service before the Edge Functions; an older service refuses the `user_id` of `/recognize` and pages are then read with B1 alone. The service needs a writable `/tmp`. The 64 MB personal model is above the 50 MB limit of the free plan in production.
- The service threshold of a personal model stays 0.129 on `ketos test` (the owner, 31/10/2026); measure 17 passes (1.1 % on 9 lines), to review in beta with real models near the threshold.
- The trainer has not run a whole task on the real GPU; a long task needs the PC kept awake.

## Notes carried from slice 2

- Cloud Run (pre-beta slice): concurrency 1, a request timeout above `ARBITRATE_TIMEOUT_MS` (30 s), a maximum number of instances; `read-page` and the relaunch task must not retry a page answered `too_complex`; give espeak an exec-allowed folder (`READING_ESPEAK_DIR`) and set `ORT_DISABLE_TELEMETRY=1` (the image does); restrict the egress of the service to Supabase; measure again an arbitration near the NER bound (about 12 s on the PC).
- Cloud Run: a bad `READING_URL` or `READING_SECRET` in production reads every page with B1 alone, with one `reading_service_misconfigured` line per cold start; the deploy must check that A gets written.
- Cloud Run: a cancelled recognition goes on in the service and holds its one-page lock; concurrency and instance count settle it. One user can keep the four places of the service busy with re-readings: add a per-user bound before Cloud Run.
- The service key lives in the process that decodes photos, and ALTO files left behind are never swept: both are for the owner to decide before Cloud Run.
- Reading loads `.safetensors` files only, through `kraken.models.load_safetensors`; never `load_models` nor `load_from_checkpoint`.
- `set-page-type` has no section in `supabase/config.toml`: `verify_jwt` defaults to true and the handler checks the token itself.
- After a `supabase db reset`, the app on the phone keeps a session for an anonymous account that no longer exists: clear the app's data before using it on the local stack.
