# Database backups

The Neon Postgres database is dumped nightly to a **Cloudflare R2** bucket by a
scheduled GitHub Actions workflow —
[`.github/workflows/db-backup.yml`](../.github/workflows/db-backup.yml). This is
the off-provider copy: it protects against losing the Neon account itself, which
Neon's own point-in-time restore cannot.

## What the workflow does

Nightly at **19:00 UTC** (03:00 HKT — a quiet hour), plus `workflow_dispatch` for
manual runs:

1. Pings `$HEALTHCHECK_URL/start` (skipped if the secret is unset).
2. Installs **postgresql-client-17** from the PGDG apt repo. The runner's stock
   `pg_dump` can be older than Neon's server, and `pg_dump` refuses to dump a
   server newer than itself — the client major version must be **>=** the server's.
   If Neon ever moves past 17, bump the package and the `/usr/lib/postgresql/17/bin`
   path in the workflow together.
3. `pg_dump -Fc --no-owner --no-privileges` → `itinerary-YYYY-MM-DD.dump` (UTC date).
   `-Fc` is the custom format: compressed, and restorable selectively with
   `pg_restore`.
4. **Fails the job if the dump is under 20 KiB.** An auth failure or an empty
   database produces a small-but-valid file; that must not be recorded as a
   successful backup.
5. Uploads to `daily/itinerary-YYYY-MM-DD.dump`, and on the **1st of the month**
   also to `monthly/itinerary-YYYY-MM.dump` — two prefixes so the lifecycle rules
   below can retain them for different lengths of time.
6. Re-reads the object with `head-object` and compares sizes. Only then does it
   ping the healthcheck success URL. An `if: failure()` step pings `/fail`.

A `concurrency: db-backup` group means a manual run can never overlap the nightly
one.

> The dump includes **booking attachments**, which are stored as `bytea` in
> Postgres rather than in object storage (see
> [architecture](architecture.md#data-layer)). Expect the dump to grow roughly
> with the size of everything uploaded, not with the row count. The repo's
> `.gitignore` already ignores `*.dump`, so a local restore drill can't
> accidentally commit one.

## One-time setup

### 1. Create the R2 bucket

Cloudflare dashboard → **R2** → **Create bucket**.

- Name: `itinerary-backups`
- Location: **Automatic** (or APAC, nearest the users) — irrelevant for restores.
- Leave public access **off**. Nothing should ever read this bucket over HTTP.

Note the **Account ID** shown on the R2 overview page; it's the `<account-id>` in
the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com`.

### 2. Create a scoped R2 API token

R2 → **API** → **Manage API tokens** → **Create API token**.

- Permission: **Object Read & Write** (not Admin — this token never needs to
  create or delete buckets).
- Specify bucket: **`itinerary-backups`** only.
- TTL: forever, or set a reminder to rotate.

Cloudflare shows the **Access Key ID** and **Secret Access Key** once. Copy both
now.

> The object-scoped token can read and write objects but **cannot** change bucket
> lifecycle rules. Configure the lifecycle from the dashboard, or mint a temporary
> Admin Read & Write token for the one CLI call below and delete it afterwards.

### 3. Add the GitHub repo secrets

GitHub → repo **hisgracejustin/itinerary** → **Settings** → **Secrets and
variables** → **Actions** → **New repository secret**.

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Neon **direct** (non-pooled) connection string — see below |
| `R2_ACCOUNT_ID` | Cloudflare account ID from the R2 overview page |
| `R2_ACCESS_KEY_ID` | From the R2 API token |
| `R2_SECRET_ACCESS_KEY` | From the R2 API token |
| `R2_BUCKET` | `itinerary-backups` |
| `HEALTHCHECK_URL` | Healthchecks.io ping URL (optional — steps skip if unset) |

**Use the direct host, not the pooler.** Vercel's `DATABASE_URL` points at
`...-pooler.<region>.aws.neon.tech`; that's PgBouncer in transaction mode, which
`pg_dump` cannot hold a consistent snapshot through. Copy the connection string
with **Pooled connection** switched off in the Neon console — the host without
`-pooler` — and keep `?sslmode=require`.

Then run the workflow once by hand: **Actions** → **DB backup** → **Run workflow**.

## R2 lifecycle: 35 days daily, 400 days monthly

### Dashboard

R2 → `itinerary-backups` → **Settings** → **Object lifecycle rules** → **Add rule**,
twice:

| Rule name | Prefix | Action |
|---|---|---|
| `expire-daily` | `daily/` | Delete objects **35** days after upload |
| `expire-monthly` | `monthly/` | Delete objects **400** days after upload |

### CLI

R2 implements the S3 `PutBucketLifecycleConfiguration` API, so this works too:

```bash
export AWS_ACCESS_KEY_ID=...        # a token with Admin Read & Write
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=auto
ACCOUNT_ID=...

cat > lifecycle.json <<'JSON'
{
  "Rules": [
    {
      "ID": "expire-daily",
      "Status": "Enabled",
      "Filter": { "Prefix": "daily/" },
      "Expiration": { "Days": 35 }
    },
    {
      "ID": "expire-monthly",
      "Status": "Enabled",
      "Filter": { "Prefix": "monthly/" },
      "Expiration": { "Days": 400 }
    },
    {
      "ID": "abort-stuck-multipart",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
JSON

aws s3api put-bucket-lifecycle-configuration \
  --bucket itinerary-backups \
  --lifecycle-configuration file://lifecycle.json \
  --endpoint-url "https://$ACCOUNT_ID.r2.cloudflarestorage.com"

# read it back
aws s3api get-bucket-lifecycle-configuration \
  --bucket itinerary-backups \
  --endpoint-url "https://$ACCOUNT_ID.r2.cloudflarestorage.com"
```

Caveats worth knowing, honestly stated:

- **The call replaces the whole configuration.** Both rules must be in the same
  JSON; a second call with one rule silently drops the other.
- **R2 supports a subset of S3 lifecycle.** Expiration by age/date, abort of
  incomplete multipart uploads, and transition to Infrequent Access are supported;
  **tag-based filters and arbitrary S3 storage-class transitions are not**. The
  prefix filters above are within the supported subset.
- **Expiration is asynchronous.** Objects are removed on a background sweep, not
  at the stroke of day 35; expect them to linger (and bill) for up to a day or so
  past the deadline. This is normal, not a broken rule.
- Recent AWS CLI v2 releases add CRC32 checksum trailers that R2 can reject. The
  workflow sets `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` /
  `AWS_RESPONSE_CHECKSUM_VALIDATION=when_required`; export the same two if a
  manual `aws` command against R2 fails with a checksum or `501` error.
- `--endpoint-url` and `AWS_DEFAULT_REGION=auto` are required on every R2 command.

## Healthchecks.io dead-man switch

The workflow succeeding is only half the signal — the failure that matters most is
the workflow **not running at all**.

1. Sign in at [healthchecks.io](https://healthchecks.io) → **Add Check**.
2. Name: `itinerary db backup`. Schedule: **Simple**, period **1 day**, grace
   **6 hours**. (Grace covers GitHub's scheduled-run queueing, which can be tens of
   minutes late on a busy hour, plus a long dump.)
3. Configure a notification method — email to the account address is enough.
4. Copy the **ping URL** (`https://hc-ping.com/<uuid>`) into the `HEALTHCHECK_URL`
   repo secret. Don't include a trailing slash; the workflow appends `/start` and
   `/fail`.

If the secret is unset every healthcheck step skips cleanly and the backup still
runs — you just lose the dead-man switch.

> **GitHub disables scheduled workflows after 60 days of repository inactivity.**
> It emails the repo owner, and a re-enable is one click in the Actions tab, but
> the email is easy to miss. This is exactly what the healthcheck catches: the
> cron stops firing, no ping arrives, and Healthchecks.io alerts after the grace
> period. Don't skip step 4 on the theory that the workflow's own failure emails
> are enough — a workflow that never starts sends none.

## Restore drill

**Run this quarterly.** An untested backup is a hypothesis. The drill takes about
fifteen minutes and is the only thing that proves the dumps are restorable, that
`pg_restore` still likes the format, and that the app boots against the result.

### 1. Fetch the latest dump

```bash
export AWS_ACCESS_KEY_ID=...        # the R2 backup token is enough (read+write)
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=auto
export R2="https://<account-id>.r2.cloudflarestorage.com"

# what's there
aws s3 ls s3://itinerary-backups/daily/ --endpoint-url "$R2" | tail -5

# newest one
LATEST=$(aws s3 ls s3://itinerary-backups/daily/ --endpoint-url "$R2" \
  | sort | tail -1 | awk '{print $4}')
aws s3 cp "s3://itinerary-backups/daily/$LATEST" ./restore.dump --endpoint-url "$R2"
ls -lh restore.dump
```

### 2a. Restore into a fresh Neon branch (closest to production)

A Neon branch starts as a copy of production, so restore into a **new, empty
database** inside it rather than over the existing one.

```bash
# Neon console → Branches → New branch (name: restore-drill), or:
neonctl branches create --name restore-drill
neonctl connection-string restore-drill --database-name neondb   # note the host

export BRANCH_ADMIN="postgres://<user>:<pw>@<restore-drill-host>/neondb?sslmode=require"
psql "$BRANCH_ADMIN" -c 'CREATE DATABASE restore_test;'

export TARGET="postgres://<user>:<pw>@<restore-drill-host>/restore_test?sslmode=require"
pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "$TARGET" restore.dump
```

### 2b. Or restore into a local Postgres in Docker (no Neon quota used)

```bash
docker run --rm -d --name pg-restore \
  -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17

export TARGET="postgres://postgres:postgres@localhost:5433/postgres"
pg_restore --no-owner --no-privileges -d "$TARGET" restore.dump
```

`pg_restore` prints warnings about missing roles or extensions even on a clean
run; those are expected with `--no-owner --no-privileges`. What matters is a zero
exit status and the row counts below.

### 3. Verify the data

```bash
psql "$TARGET" -c '\dt'
psql "$TARGET" -c "
  SELECT 'trips' t, count(*) FROM trips
  UNION ALL SELECT 'bookings', count(*) FROM bookings
  UNION ALL SELECT 'booking_attachments', count(*) FROM booking_attachments
  UNION ALL SELECT 'expenses', count(*) FROM expenses
  UNION ALL SELECT 'settlements', count(*) FROM settlements
  UNION ALL SELECT 'todos', count(*) FROM todos
  UNION ALL SELECT 'users', count(*) FROM users;"

# attachments are bytea — confirm the bytes came across, not just the rows
psql "$TARGET" -c \
  "SELECT count(*), pg_size_pretty(sum(octet_length(content))::bigint)
   FROM booking_attachments;"
```

### 4. Point a local build at it

```bash
# in .env.local
DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres
AUTH_SECRET=$(openssl rand -base64 32)
# leave AUTH_GOOGLE_ID unset → the login page offers dev sign-in

npm run build && npm run start   # http://localhost:3000
```

Sign in as an allowlisted email, open the calendar, a booking with an attachment,
and the costs page. If those render, the backup is good.

### 5. Tear down

```bash
neonctl branches delete restore-drill    # or: docker rm -f pg-restore
rm restore.dump
git status                               # should be clean; *.dump is gitignored
```

Record the date you ran the drill somewhere you'll see it — a to-do in the app is
fine.

## What protects against what

| Layer | Window | Protects against | Doesn't help with |
|---|---|---|---|
| **Neon PITR** (branch/restore to a timestamp) | Your plan's history-retention setting — Free defaults to **24 h**, paid plans allow up to 7–30 days. Check Neon console → Project settings → Storage. | Fat-fingers: a bad migration, a mass delete, a wrong `UPDATE`. Restores in minutes, no dump needed. | Anything that takes the Neon account or project with it. |
| **Nightly R2 dump** | 35 days of dailies, 400 days of monthlies | Losing Neon entirely — account suspension, billing lapse, project deleted, provider outage or exit. A different company holds the bytes. | Fine-grained recovery. Worst case you lose up to 24 h of changes, and restoring means the drill above. |

Reach for PITR first for anything that happened today; the R2 dump is the parachute
for the day Neon isn't there to ask.
