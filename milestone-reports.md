# Milestone reports

One entry per milestone in `progress.md`, written when it is done: what was built, what was checked, and anything the next person should know.

## Milestone 1: generator repository

Fern CLI 5.146.2 pinned in `package.json`; generators pinned in `fern/generators.yml` at TypeScript 3.98.5, Python 5.34.3, Go 1.65.3, Java 4.24.2, C# 2.86.2, PHP 2.24.2. These are the versions `fern generator upgrade --include-major` resolved on 6 October 2026.

Local generation was confirmed to need no Fern account: with no token in the environment, `fern generate --local` pulled each generator's public image and ran it. The `--package` flag turned out to be what makes Fern write a complete, buildable project to the local file system; without it the TypeScript, Python, and Java outputs are source only, with no `package.json`, `pyproject.toml`, or `build.gradle`. The `--force` flag answers the prompt about an output directory that already has files, which every repository does because of `.git`.

Package identity reaches local output through generator configuration rather than an output block: `packageJson.name` for TypeScript, `package_name` for Python, `module.path` for Go, `package-prefix` with `package-name` for Java, `package-id` for C#, `packageName` for PHP. This was read from Fern's CLI source, in `getFilesystemPublishTarget`, and confirmed by generating.

## Milestone 2: six libraries

All six generated from `openapi/released/1.0.0.json` and built in Docker: an npm tarball, a wheel, a JAR with its POM, a NuGet package, and a Composer archive; Go has no package format and was built and vetted with the host toolchain instead. Zero runtime dependencies in the TypeScript package.

Unknown enum values, read from the generated types: TypeScript has string literal unions with no runtime validation (Fern's serde layer is off by default); Python types each enum as `Union[Literal[...], Any]`; Go types them as `string`; Java generates a class with an `UNKNOWN` case when `enable-forward-compatible-enums` is on; C# generates a string-backed record struct with the same setting; PHP types the property as `string` with the enum as documentation.

## Milestone 3: surface check

`scripts/check-surface.mjs` found 84 of 85 operations in every language on the first run. The missing one was `searchListings`, which Fern had renamed to `listings` under the `search` resource. Pinned by `fern/overlays.yml` (decision D3), together with the request type's name, which the method-name extension would otherwise have changed to `SearchListingsSearchRequest`.

## Milestone 4: determinism

The first comparison was between a packaged run and an unpackaged one, and showed that Fern writes a complete project only when packaging: without `--package` the TypeScript, Python, and Java outputs are source-only trees with a different layout. The script therefore always packages. The same comparison showed the Java sample app's build output surviving cleanup, now removed.

Two full packaged runs then produced identical SHA-256 hashes for every file in all six repositories.

## Milestones 5 and 6: smoke tests

`smoke/run.mjs` issues a test-mode secret key by signing in through the backend's log, creates a seller for the mock server to serve, and runs each language's test. TypeScript, Python, and Go run on the machine; Java, C#, and PHP run in the official Docker images and reach the backend as `host.docker.internal` (decision D14). Each test creates a seller with an `Idempotency-Key`, replays the call and gets the same seller, lists with a limit, reads the seller back, sends a 201-character `external_id` and gets a typed 400 carrying `code` and `request_id`, then reads a seller from the mock, whose status is a value the description does not have and which carries two unknown fields.

All six pass. Two things were learned on the way. The Python library validates required response fields, so the mock must serve a complete seller, which is why it serves a real one with the unknown bits added. And `inlinePathParameters` changed nothing in the TypeScript, Go, or C# generators, so those three keep a request object for a path id (decision D11).

## Milestone 7: releasing

Each repository gets a `RELEASING.md` from the script, with the one-time registry setup and the commands for a release. Java's route is a local Maven-layout publish, GPG signatures, and a bundle upload to the Central Portal, because the generated build has publishing credentials but no signing. The generated POM needed two corrections for Central, made by the script (decision D12).

## Milestone 8: documentation

A new guide at `/docs/sdks`, second in the reading order, with the install table, a first call in each language from the READMEs, what every library does, the browser note, and where versions are explained. The versioning guide gained its SDK section. Wording is in `copy/09-docs-sdks.md` and `copy/08-docs-versioning.md`. Lint and the production build pass.
