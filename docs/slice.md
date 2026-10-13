# Current slice

Slice 2 — HTR and second witness.

Paths below are from the repository root.

- **Spec:** `../../02 Design/Spec tranche 2.md`, validated by the owner on 12/10/2026.
- **Plan:** `../../02 Design/Plan tranche 2.md`, validated by the owner on 12/10/2026, with its "Points à trancher" as proposed.
- **Next branch:** `t2/segmentation`, once the owner has merged the PR of `t2/service-ci`. If that PR is still open, stop and ask.
- **Pauses:** after branches 3, 6, 9 and 12, in `../Tranche 2/Pause 1.md` to `Pause 4.md`.
- **Measures:** scripts and results in `../../04 Testing/T2 mesures/`, outside the repository.

## Branches

| # | Branch | Group | Sensitive | Merged by | State |
|---|---|---|---|---|---|
| 1 | `t2/service-ci` | 1 | yes | owner | PR open, for the owner to merge |
| 2 | `t2/segmentation` | 1 | no | Claude | to do |
| 3 | `t2/recognition` | 1 | yes | Claude | to do |
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

## Notes for the next branches

- Branch 3: FastAPI's default 422 answer echoes the input; `/recognize` needs a handler with a fixed body, and a test. Catch errors at the route and log a code, never the message of a library.
- Reading loads `.safetensors` files only, through `kraken.models.load_models`; never `load_from_checkpoint`.
