# marketsdk-sdk-generator

Regenerates the MarketSDK client libraries from the API description. Nothing in any SDK repository is written by hand; everything comes from here.

| Library | Repository | Package |
| --- | --- | --- |
| TypeScript | [marketsdk-typescript](https://github.com/focussofthq/marketsdk-typescript) | `@marketsdk/js` on npm |
| Python | [marketsdk-python](https://github.com/focussofthq/marketsdk-python) | `marketsdk` on PyPI |
| Go | [marketsdk-go](https://github.com/focussofthq/marketsdk-go) | `github.com/focussofthq/marketsdk-go` |
| Java | [marketsdk-java](https://github.com/focussofthq/marketsdk-java) | `com.marketsdk:marketsdk-java` on Maven Central |
| C# | [marketsdk-csharp](https://github.com/focussofthq/marketsdk-csharp) | `MarketSDK` on NuGet |
| PHP | [marketsdk-php](https://github.com/focussofthq/marketsdk-php) | `marketsdk/php` on Packagist |

The API description is generated from the MarketSDK backend and published at https://api.marketsdk.com/v1/openapi.json. Its versioning rules are at https://marketsdk.com/docs/versioning.

## How it works

[Fern](https://github.com/fern-api/fern) reads the description and generates each library inside a Docker container on the machine that runs this script. Fern's CLI and generators are Apache-2.0, the generators' images are public, and Fern puts no license on generated code. Generation runs entirely locally: no Fern account, no token, no network traffic other than pulling the generator images. Fern's documentation describes writing generated SDKs to the local file system as available on its open source plan.

Every version is pinned: the Fern CLI in `package.json`, each generator in `fern/generators.yml`. The same description and the same configuration always produce the same files, so a diff in an SDK repository always comes from a change in one of those two.

| File | What |
| --- | --- |
| `fern/generators.yml` | One group per library: generator, version, naming, package metadata, output path |
| `fern/overlays.yml` | The one place the description is adjusted for Fern, without editing it. See the comment inside. |
| `fern/openapi/marketsdk-v1.json` | The description the libraries were last generated from. Written by the script. |
| `scripts/regenerate.mjs` | Fetches a released description, generates every library, writes `GENERATED`, `LICENSE`, `CONTRIBUTING.md` into each repository |
| `scripts/check-surface.mjs` | Checks that every operation in the description is a method in every library, and that nothing was removed or renamed since the last release |
| `smoke/` | One smoke test per library against a local backend in test mode, run by `node smoke/run.mjs <backend log>`. Needs Docker, Node, Python 3.10+, Go, and the backend started with `host.docker.internal` among its API hosts. |
| `surface/<language>.txt` | The public method list of each library at the last release |

## Regenerating

You need Node 24 or newer, Docker running, and the six SDK repositories checked out beside this one under their own names.

```bash
npm install
node scripts/regenerate.mjs --description 1.0.0 --sdk-version 1.0.0
```

`--description` is the API description version to generate from. The script fetches it from https://api.marketsdk.com/v1/openapi.json and refuses to continue if the served file's `info.version` differs. For work before a description is served, `--from <file>` names a local copy of the released file.

`--sdk-version` is stamped into every package. `--group <name>` limits the run to one library and may be repeated. Every run builds each package in Docker; Fern writes a complete project only when it packages, and the build is the compile check.

The run does, for each library:

1. Empties the repository, keeping only `.git`.
2. Generates the library, and builds its package in the language's official Docker image to prove it compiles. The artifact itself is discarded.
3. Removes build output, Fern's metadata folder, and Fern's dated changelog.
4. Writes `LICENSE` (MIT, Focussoft HQ LLC), `CONTRIBUTING.md`, `RELEASING.md`, additions to `.gitignore`, and `GENERATED`.
5. For Java only, corrects two lines of `build.gradle` that Fern fills in only when it publishes to GitHub itself: the POM's name and its source-control URL. See `decisions.md`, D12. It is the only change made to generated output, and the script stops if the generator's text has changed.

Then:

```bash
node scripts/check-surface.mjs
```

It must say `ok` for every language. `missing from the SDK` means the generator did not produce a method for an operation; the fix is in `fern/generators.yml` or `fern/overlays.yml`. `removed since the last release` means a method the previous release had is gone, which is a breaking change: either fix the configuration or release a major version, and record the new surface with `--write`.

## Upgrading a generator

1. Change the version in `fern/generators.yml`. `npx fern generator list` shows what is available; `npx fern generator upgrade` would change every version at once, so prefer editing by hand.
2. Regenerate that library with `--group`.
3. Run the surface check. A renamed method means the upgrade is a major version of that library, or is not taken.
4. Read the diff in the SDK repository before releasing. A generator upgrade with the same public surface is a patch release.

Upgrading the CLI is the same, with the version in `package.json` and `fern/fern.config.json` changed together.

## Releasing

The description is released first, by the backend's own steps. Then, for each library:

1. `node scripts/regenerate.mjs --description <api version> --sdk-version <sdk version>`
2. `node scripts/check-surface.mjs`, and `--write` once it passes.
3. In the SDK repository: review the diff, commit, tag `v<sdk version>`.
4. Publish, as its `RELEASING.md` says.
5. Commit the new `fern/openapi/marketsdk-v1.json` and `surface/` here.

The docs on https://marketsdk.com/docs/sdks change last, so they never describe a version that cannot be installed.

### SDK version numbers

| What changed | SDK version |
| --- | --- |
| Regenerated from a new minor of the description, which added endpoints, fields, or values | Minor |
| Regenerated from a patch of the description, or a generator upgrade with the same public surface | Patch |
| Any removed or renamed public method, type, or field, whatever caused it | Major |

The description's own rules forbid removals and renames within v1, so a major SDK release can only come from a generator change.

## Names

| | Package | Client |
| --- | --- | --- |
| TypeScript | `@marketsdk/js` | `new MarketSDK({ token })`; types under the `MarketSDKApi` namespace |
| Python | `marketsdk` | `MarketSDK(token=...)`, and `AsyncMarketSDK` |
| Go | `github.com/focussofthq/marketsdk-go` | `client.NewClient(option.WithToken(key))` |
| Java | `com.marketsdk:marketsdk-java` | `MarketSDK.builder().token(key).build()` |
| C# | `MarketSDK` | `new MarketSDKClient(key)` in namespace `MarketSDK` |
| PHP | `marketsdk/php` | `new MarketSDKClient($key)` in namespace `MarketSDK` |

Resources are the description's tags: `client.sellers`, `client.orders`, and so on. Methods are the description's `operationId`, in the language's casing.
