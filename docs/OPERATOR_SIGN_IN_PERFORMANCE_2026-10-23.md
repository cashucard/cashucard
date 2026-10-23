# Operator sign-in performance — 2026-10-23

Issue #121 recorded production operator sign-in requests taking 8,847 and
8,719 ms, versus 75–262 ms for subsequent authenticated admin reads. This
change has not yet been deployed or measured against those accounts.

## Local result and scope

The repository's pinned local workerd runtime, with the deployed compatibility
date `2026-10-13` and `nodejs_compat`, ran a standalone temporary Worker with
public fixture input, no accounts, no Durable Object/R2 bindings and no remote
service calls. Timings were taken by the host around each request because the
Worker's own clock is unsuitable for measuring a synchronous KDF.

| Sample | Native scrypt 32768/8/3 | Existing PBKDF2-600k JS fallback |
|---|---:|---:|
| 1 | 128 ms | 2,131 ms |
| 2 | 96 ms | 2,182 ms |
| 3 | 148 ms | 2,116 ms |

The median local KDF difference is approximately 16.6×. This is not a claim
about deployed network/login latency. It excludes database work, first-login
legacy verification/migration, cold starts and edge-specific native cost caps.
Run it from `ops/` after the frozen dependency install:

```sh
node tools/password-benchmark.cjs
```

The tool prints only mode, duration and a public-fixture/runtime label. Its
dependencies are the development tools already pinned through Wrangler.

## Compatibility and rollout checks

The first successful legacy login must still verify the existing full hash.
Only then can the transaction replace it with the memory-hard profile and
issue a session. Subsequent logins use native scrypt. Incorrect passwords do
not change credentials; administrator recovery during verification/rehashing
must win. The durable rate budget, revocation and key-environment checks stay
in place. Old PBKDF2 and scrypt hashes remain readable. An edge cost refusal
retains the legacy hash without doubling its PBKDF2 cost; unrelated crypto
errors fail closed. See [D103](DECISIONS.md#d103).

Before closing #121, deploy the reviewed service, measure one normal successful
legacy login and a subsequent successful login through the user-operated UI,
and confirm failure/rate-limit behavior under an explicitly scoped check. Do
not extract production passwords or hashes for a benchmark or introduce a
public performance/debug endpoint. No production rollout occurred for this
local result.
