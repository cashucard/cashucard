<a id="operator-sign-in-performance--2026-10-23"></a>

# Operator sign-in performance: 2026-10-23

Issue #121 recorded production operator sign-in requests taking 8,847 and
8,719 ms, versus 75–262 ms for subsequent authenticated admin reads. This
change was subsequently deployed; operator-observed acceptance is recorded below.

## Local result and scope

The repository's pinned local workerd runtime, with the deployed compatibility
date `2026-10-13` and `nodejs_compat`, ran a standalone temporary Worker with
public fixture input, no accounts, no Durable Object/R2 bindings and no remote
service calls. Timings were taken by the host around each request because the
Worker's own clock is unsuitable for measuring a synchronous KDF.

| Sample | Native scrypt 16384/8/5 | Existing PBKDF2-600k JS fallback |
|---|---:|---:|
| 1 | 98 ms | 2,063 ms |
| 2 | 74 ms | 2,105 ms |
| 3 | 75 ms | 2,090 ms |

The median local KDF difference is approximately 27.9×. This is not a claim
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
in place. Old PBKDF2 and scrypt hashes remain readable. The new profile also fits the previous deployment’s default scrypt memory limit, so its verifier can read migrated credentials during a rollback. An edge cost refusal
retains the legacy hash without doubling its PBKDF2 cost; unrelated crypto
errors fail closed. See [D103](DECISIONS.md#d103).

## Production rollout and operator acceptance

The reviewed service is deployed from `4dc623930d2a21f5527993f8fbcfd1d519dc0a19`
as Worker version `e3591bcb-2492-404c-aaae-40ee2a22a3d0`, preserving the original
API origin, database, bindings and export schedules. Both HTML surfaces retain
no-transform and their original restrictive CSP. The deployment smoke check
also confirmed the service authentication boundary.

On SuperMax (iPhone 17 Pro, iOS 26.6.2), build 1.0.0 (7), source #134,
the operator reported an initial successful sign-in taking **about four seconds**,
then signed out and back in repeatedly; every repeat was **almost instant**.
The Cards screen showed NEW BATCH. This matches the expected one-time legacy
verification/upgrade followed by native verification, but no stored hash was
inspected. These timings are user observations. An instrumented before/after comparison
with the earlier Chrome baseline remains pending.

The operator also confirmed Sign In remains visible while typing with the
keyboard open and the removed demo entry is absent. Compatibility, revocation,
rate budgeting and failure behavior have focused Node/Workers regression
coverage. No deliberate bad-password/rate-limit probe was run against the
production operator, and no production password/hash was extracted. #121’s
remaining instrumented success/failure timing acceptance is separate from this
confirmed usability improvement.
