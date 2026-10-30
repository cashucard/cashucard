# Standalone ops-service container

The image runs the operator console and provisioning API on Node 22 with
SQLite. It includes initialization, encrypted export and fenced restore
commands. Build it from the repository root. CI builds and exercises the image
on native Linux AMD64 and ARM64 runners.

## Build and initialize

Docker Engine with Compose is required. Use a distinct Compose project name
for each issuer. These commands use `my-issuer`:

```sh
docker compose -p my-issuer -f ops/compose.yaml build ops
docker compose -p my-issuer -f ops/compose.yaml run --rm setup init issuer-admin
docker compose -p my-issuer -f ops/compose.yaml up -d ops
```

`OPS_IMAGE` selects an existing image tag instead of `cashu-card-ops:local`.
`OPS_HTTP_PORT` changes the published loopback port. Preserve an exact image
version or digest in deployment configuration when distributing a release.

Ops component releases also publish `ghcr.io/cashucard/ops-service:VERSION`
for Linux AMD64 and ARM64. To use a published release, set `OPS_IMAGE` to
its exact version or digest, run `docker compose pull ops setup` with the same
project/file options, then use the initialization and startup commands above
with `up -d --no-build ops`. The release's `ops-container.json` records its
source commit, platforms and immutable registry digest.

Initialization creates a random master and an issued-environment operator
password in the private `ops-secrets` volume. It refuses a nonempty secrets
directory. Save the master in your secrets vault and independent recovery
custody. Copy the setup file to a protected directory with `docker compose cp`,
then import its password into your password manager. File contents belong in
your private credential workflow; command output reports paths and status.

```sh
# Replace the destination with an existing protected directory you control.
umask 077
docker compose -p my-issuer -f ops/compose.yaml cp ops:/secrets/operator-setup.json /protected/cashu-ops/operator-setup.json
docker compose -p my-issuer -f ops/compose.yaml cp ops:/secrets/master-key /protected/cashu-ops/master-key
```

The console is available at `http://127.0.0.1:8821/ops/operators`. Sign in as
`issuer-admin` using the generated password. Create separate named accounts
for routine provisioning. The initial setup completes before the listener
opens. Its stored nonce prevents bootstrap or recovery from replaying on restart.

After verifying access and saving the credentials, remove
`OPS_OPERATOR_SETUP_FILE` from the Compose environment and recreate the service.
Remove the initialization file using the setup helper:

```sh
docker compose -p my-issuer -f ops/compose.yaml up -d ops
docker compose -p my-issuer -f ops/compose.yaml run --rm --entrypoint node setup -e "require('node:fs').unlinkSync('/secrets/operator-setup.json')"
```

For password recovery, mount a new setup JSON with `action: "recover"`, a new
nonce, the existing name and the replacement password through
`OPS_OPERATOR_SETUP_FILE`. The [operator setup contract](../README.md#recover-operator-access)
defines its fields. Remove the setup configuration after successful recovery.

## Domain and mobile connection

Point your domain's DNS to the host running the service. Configure a trusted
HTTPS reverse proxy to forward that hostname to `127.0.0.1:8821`, preserving
the Authorization header. The Compose example exposes HTTP only on host
loopback; the image listens on all container interfaces.

Open `https://your-ops-domain/ops/operators`, verify sign-in, then choose that
HTTPS origin through the CCP app's service selector. Each deployment has its
own accounts, card records and manager keys. Existing phone journals retain
their original service and operator binding.

## Configuration

| Setting                   | Purpose                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPS_MASTER_KEY_FILE`     | Read the issuer master from a mounted regular file. `OPS_MASTER_KEY` is an alternative for an existing secret-manager environment. Set one source. |
| `OPS_OPERATOR_SETUP_FILE` | Optional private bootstrap/recovery JSON. `OPS_OPERATOR_SETUP` is the direct secret-manager alternative.                                           |
| `OPS_OPERATOR_ADMINS`     | Required JSON array of existing administrator names; the example starts with `issuer-admin`.                                                       |
| `OPS_DB`                  | SQLite path, default `/data/ops.sqlite`.                                                                                                           |
| `OPS_HOST`, `OPS_PORT`    | Container listener, default `0.0.0.0:8821`. Keep the host publication behind HTTPS.                                                                |
| `OPS_MINTS`               | Optional JSON array of HTTPS mint references offered to operators. Defaults are in `src/config.ts`.                                                |
| `OPS_BACKUP_RECIPIENT`    | Public age recipient used by `backup`; keep its private recovery identity separately.                                                              |
| `OPS_BACKUP_DIR`          | Encrypted export directory, default `/backups`.                                                                                                    |

Mounted secret files are bounded regular files. Configure secret-file ownership
so the container's `node` user (UID 1000) can read them. The named volume in
the example handles ownership for initialization. Runtime uses production
dependencies, an unprivileged user, a read-only root filesystem and a read-only
secret mount. SQLite and encrypted backups have separate writable volumes.

`GET /healthz` checks the live database. `GET /readyz` returns 503 when operator
setup is incomplete, the recovery fence is active or a configured independent
backup fence is stale. Health responses contain status only. The process drains
HTTP requests on SIGTERM and closes SQLite, with a 15-second shutdown bound.

## Backups and restoration

Set `OPS_BACKUP_RECIPIENT` to your public age recipient and run:

```sh
docker compose -p my-issuer -f ops/compose.yaml exec -T ops node dist/standalone.js backup
```

The command reads a consistent database snapshot and writes a uniquely named,
encrypted `.age` file to `/backups`. Schedule this command with your platform's
scheduler, copy completed files to independent storage, and verify a restore.
Retain older successful copies. Choose an export and copy interval that meets
your accepted data-loss window. Keep the private age identity outside the
running service and backup storage.

Restore with the same image's `restore /path/to/export.age` command into a fresh
`OPS_DB`, mounting the protected identity through `OPS_RECOVERY_IDENTITY_FILE`
and the encrypted artifact read-only. The existing [restore procedure](../README.md#restore-without-the-original-service)
defines identity-file permissions, credential recovery and reconciliation.
Restoration disables passwords and installs the recovery fence. Review outstanding
card attempts before reopening issuance.

This container provides filesystem exports and the Node provisioning API.
The Cloudflare adapter currently provides the R2 scheduler, Atoll pairing,
independent-copy receipt HTTP API and backup-status dashboard. Their Node
adapters remain separate work. Setting `OPS_INDEPENDENT_BACKUP_ISSUER` here
enforces the existing fence; a fresh Node deployment has no receipt-enrollment
HTTP path to satisfy it.

## Upgrades and storage

Run one service process per SQLite database on local persistent storage.
Protect the data volume: it contains operational escrow in plaintext. Preserve
the Compose project name, data and secrets volumes across upgrades. Take an
encrypted export and verify recovery access before changing the image.

Migrations are forward-only. A container rollback leaves database writes in
place; use a release that understands the current schema. `docker compose down`
retains the named volumes; adding `--volumes` deletes the issuer's data and
secrets. Keep the master and independent recovery copies outside that lifecycle.

## Verification

```sh
docker build -f ops/Dockerfile -t cashu-card-ops:test .
node ops/docker/smoke.cjs
```

The single disposable journey initializes a private issuer, signs in, creates
a batch, restarts the container, checks session persistence, exports encrypted
data and restores it into a separate fenced database. It checks unprivileged
execution and credential-free logs, then removes only its own containers and
volumes. It uses synthetic data and contacts the local container only.
