# Current slice

Slice 2 — HTR and second witness.

Paths below are from the repository root.

- **Spec:** `../../02 Design/Spec tranche 2.md`, validated by the owner on 12/10/2026.
- **Plan:** `../../02 Design/Plan tranche 2.md`, validated by the owner on 12/10/2026, with its "Points à trancher" as proposed.
- **Next branch:** `t2/schema`, after the owner has done Pause 1 (`../Tranche 2/Pause 1.md`).
- **Pauses:** after branches 3, 6, 9 and 12, in `../Tranche 2/Pause 1.md` to `Pause 4.md`.
- **Measures:** scripts and results in `../../04 Testing/T2 mesures/`, outside the repository.

## Branches

| # | Branch | Group | Sensitive | Merged by | State |
|---|---|---|---|---|---|
| 1 | `t2/service-ci` | 1 | yes | owner | merged |
| 2 | `t2/segmentation` | 1 | no | Claude | merged |
| 3 | `t2/recognition` | 1 | yes | Claude | done |
| 4 | `t2/schema` | 2 | yes | Claude | to do |
| 5 | `t2/arbitrate` | 2 | yes | Claude | to do |
| 6 | `t2/read-page` | 2 | yes | Claude | to do |
| 7 | `t2/rules` | 3 | no | Claude | to do |
| 8 | `t2/replay` | 3 | no | Claude | to do |
| 9 | `t2/ner` | 3 | no | Claude | to do |
| 10 | `t2/page-type` | 4 | yes | Claude | to do |
| 11 | `t2/document` | 4 | no | Claude | to do |
| 12 | `t2/formulas` | 4 | yes | owner | to do |

## Decisions taken without the owner

- **Licence of `medium`** (branch 1): Apache-2.0 on Zenodo record 21788410, commercial use allowed, the file identical to the one of the Cold Spike. Its model card lists the IAM Handwriting Database among its training data, whose terms are for non-commercial research: noted in the spec for the owner, not a reason to stop.
- **Secret of the service** (branch 1): header `X-Reading-Secret`, at least 32 characters, no leading or trailing space; the service does not start otherwise.
- **Versions** (branch 1): `multidict` 6.9.1, `urllib3` 2.8.0 and `pytorch-lightning` 2.6.6 instead of the versions of `~/kraken-env`, to fix advisories; none of them takes part in the reading. `lightning` 2.6.1 stays, pinned by Kraken 7.1.1, its advisory in `services/reading/audit-allowlist.txt` (reason in `CLAUDE.md`).
- **Lock and Dependabot** (branch 1): uv and `uv.lock`, so Dependabot follows the `uv` ecosystem rather than `pip`; it ignores `kraken`, `torch`, `torchvision` and `lightning`.
- **Local port** (branch 1): the service is also published on `127.0.0.1:54340`, for the measures run on the PC; never on the local network.
- **Guarded files** (branch 1): the Edit and Write tools refuse them, and writing them through a shell was refused as a bypass. The changes were prepared as patches in `../Tranche 2/` and applied with the owner's approval in chat. `CLAUDE.md` now says so. The reviews added `services/reading/check.sh` to the guarded files and denied `docker inspect`, `docker exec` and `docker compose config`, which print the secret.

- **One thread for `blla`** (branch 2): `kraken segment` bounds the OpenMP and BLAS threads to 1 by default (`threadpool_limits`, `num_threads = 1`); the service does the same around `blla`. Without it, 5 pages of 21 were segmented differently from the spike's Kraken on the processor; with it, 21 of 21 are identical. Cost: about 40 % more time to segment (about 11 s a page on the PC).
- **Measure of branch 2**: 310 lines of 310, at the same rows on the 21 pages. Fed the pinned segmentation, the service gives the 310 tiles identical to the pixel. With its own segmentation on the processor, 233 are identical and 77 differ slightly, because the pinned segmentation ran on the graphics card (shown on 21 pages of 21); only one line changes its ink, on `Chapitre 1`, the math page. Results in `../../04 Testing/T2 mesures/segmentation/Résultats.md`.
- **Tests of the segmentation** (branch 2): synthetic pages drawn with Pillow's default font; the printed grid of the plan is a ruling dark enough to pass for ink (a darker grid that touches the letters takes them with it, as in the pinned chain).

- **Measure of branch 3**: 310 lines on the 21 pages, 33.01 % CER outside math through `POST /recognize`, 0.21 point above the Cold Spike's 32.8 %. The instrument finds 32.80 % on the published flux; the 310 pinned tiles read by the service give 32.95 %: 0.15 point comes from the processor in 32 bits against the graphics card in `bf16-mixed`, 0.06 from the processor's segmentation. 28 s a page in median, 36 s at most. Results in `../../04 Testing/T2 mesures/recognition/Résultats.md`; noted in the spec under criterion 1.
- **Word boxes** (branch 3): from Kraken's cuts, as its ALTO serializer does. With `medium` each character's cut is a single point, so a box runs from the first character's point to the last one's (plus one tile pixel, the width of a pixel in continuous coordinates): it falls short of the end of the last letter, by about one letter, and a one-letter word is one tile pixel wide. Widening the boxes would leave the plan's rule ("the boxes come from the ALTO"); branch 5 uses them as anchors as they are.
- **The ALTO** (branch 3) is written by the service with ElementTree, not by Kraken's template: page size, one `TextLine` per line with its box on the photo, one `String` per word with `CONTENT`, its box and `WC` (4 decimals); no `Glyph` and no `SP`. The 1,622 labels of `medium` hold no character XML forbids, so the ALTO is always well-formed with this model; a personal model with another codec (slice 5) must be checked again.
- **Orientation** (branch 3): the service turns a photo upright by its orientation tag before reading, so boxes are on the upright photo. The app saves photos without a tag, so the boxes are on the stored photo as it is.
- **Limits of the service** (branch 3, from the security review): a photo is walked before decoding: only the markers a baseline or progressive JPEG carries (frames SOF0 to SOF2, tables, APPn, comments, scans, end), at most 16 scans, nothing between segments (a crafted progressive JPEG of 690,000 scans took 98 s to decode; scans hidden behind an `FF 00` got past the first walker). A stray byte between segments, which libjpeg tolerates, is refused: the app writes clean JPEGs. `blla` runs on a reduced copy of the photo, so the deadline, checked between lines, does not need to cover it; a page of more than 40,000 ink components (the corpus has at most 4,540), or a reading longer than 120 s (the corpus takes 36 s at most), answers 422 `too_complex`; beyond four requests in flight, 503 `busy`. A slow body has no time limit of its own: Cloud Run's request timeout will cover it.
- **Local variables** (branch 3, for Pause 1): `services/reading/.env` holds `READING_SECRET`, `SUPABASE_URL` (`http://supabase_kong_NotesScannerApp:8000`, the stack's gateway on its network) and `SUPABASE_SERVICE_ROLE_KEY`; `.env.example` lists them. `supabase/functions/.env` gets `READING_URL` (`http://notes-reading:8080`) and the same `READING_SECRET`. Branches 5 and 6 use these names.

## Notes for the next branches

- Reading loads `.safetensors` files only, through `kraken.models.load_models`; never `load_from_checkpoint`.
- The contract of `POST /recognize` is in `CLAUDE.md` (`services/reading/`). Branch 6: send the stored photo's bytes as they are, the page id in lowercase; retry once on 500 `reading_failed` or 503 `busy` or a network failure, never on 400, 413, 415 or 422 (`too_complex` would take two minutes again for nothing). A reading takes about 30 s on the PC and up to 120 s before `too_complex`: the call's timeout must be above that, and within the wall-clock limit of an Edge Function's background task (check it for the local runtime and for the production plan).
- Branch 5: `/arbitrate` takes A as `/recognize` answers it. A word's anchor is its `box`; a line's box for a word of B1 without a word of A is the line's `box` (the tile on the photo), or its `ink` box if the tighter one is wanted: decide there and write it down.
- Branch 5 and later: the `Reader` lock reads one page at a time; segmentation and recognition must stay on its thread. `/arbitrate` does no Kraken work and need not take the lock.
- Cloud Run (end of slice 4): concurrency 1, a request timeout, a maximum number of instances; `read-page` and the relaunch task must not retry a page answered `too_complex`.
