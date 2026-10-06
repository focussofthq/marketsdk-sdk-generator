# Progress

Where the SDK work stands against `specs/marketsdk-sdks/requirements.md` in `marketsdk-specs`. States are "Done", "In progress", or "Not started".

## Milestones

| | Milestone | State |
| --- | --- | --- |
| 1 | Generator repository: pinned Fern, configuration for six libraries, regenerate script | Done |
| 2 | Six libraries generated from description 1.0.0, each building in its language's official image | Done |
| 3 | Surface check: every operation is a method in every library, recorded in `surface/` | Done |
| 4 | Determinism: a second run on the same inputs changes no file | Done |
| 5 | Smoke tests against a local backend in test mode, all six languages | Done |
| 6 | Unknown field and unknown enum value accepted, proven with a mock response | Done, inside the smoke tests |
| 7 | `RELEASING.md` in each repository with the registry steps | Done |
| 8 | Documentation on marketsdk.com: the SDKs guide and the versioning section | Done, pending `npm run ci` |
| 9 | First publish of every package at 1.0.0 | Not started. Ausaf publishes. |

## Done when, from the requirements

| Condition | State |
| --- | --- |
| All six regenerate from `1.0.0.json` with the pinned script, and a second run changes nothing | Done. Two full runs, identical file hashes in every repository. |
| Each builds with its language's standard command on a clean clone | Done through Fern's packaging step in Docker, and again by the smoke tests, which build each library from its repository. |
| Each smoke test passes against a local backend in test mode | Done, all six: create with `Idempotency-Key`, replay, list with a limit, read back, a 400 as a typed error with `code` and `request_id`. |
| Each parses a response with an unknown field and an unknown enum value | Done, all six, against a mock serving a real seller with an unknown status and two unknown fields. |
| Public method names match the description's `operationId` list, one to one | Done, 85 of 85 in every language. |
| MIT license in `LICENSE` and in package metadata, naming Focussoft HQ LLC | Done. |
| Published at 1.0.0 and installable on a clean machine | Not started. |
| `marketsdk-web` passes `npm run ci` with the new guide and versioning section | Lint and the production build pass; the full gate is being run. |
| Nothing in any SDK repository edited by hand | Holds. The one scripted correction is decision D12. |
