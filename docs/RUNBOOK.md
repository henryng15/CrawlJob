# Runbook

What to do when something is wrong. Written for the person who owns this system,
which is the same person who built it and will have forgotten the details.

Every section starts with how to tell the problem apart from the things it
resembles, because most of the time here is spent on the wrong diagnosis.

---

## Daily check

```bash
uv run internship-ops status
```

Or open the dashboard. Three things matter:

| What | Healthy | Wrong |
|---|---|---|
| `dead` in the queue | 0 | Anything above 0 — a task gave up. See below. |
| Applications waiting on you | small | Growing daily means you are the bottleneck, not the system. |
| Drafts ready | small | Same. |

---

## "The dashboard is empty"

Open **/setup**. It exists for exactly this: an empty dashboard because nothing
was discovered looks identical to one because no board is being watched.

If setup is complete and it is still empty:

```bash
uv run internship-ops sources     # is anything enabled?
uv run internship-ops status      # is anything queued?
```

Discovery runs **once a day at 07:00 Eastern**. Before then on a fresh install,
nothing has run yet. To not wait:

```bash
uv run internship-ops discover greenhouse stripe --now
```

---

## Tasks are dying

```bash
docker compose -f docker-compose.prod.yml logs worker --tail 200 | grep -i "failed\|no handler"
```

A `DEAD` task means the handler said "stop", not "try again". The message says
which. The common ones:

| Message | Means | Do |
|---|---|---|
| `no handler for X` | This worker does not implement that stage | Check the worker started the browser slot too, if X is `PREPARE_APPLICATION` or `REPLAY_APPLICATION` |
| `no candidate name is set` | Nothing to sign an email with | Set it on **/setup** |
| `no recruiter is assigned` | Nobody matched for that company | Pick one on the outreach page |
| `no base resume is available` | `BASE_RESUME_PDF` is unset or points at nothing | `internship-ops check-base-resume`, then fix the path |
| `a CAPTCHA is present` | Working as designed | Open the live review link and finish it yourself |

### An application has no resume

`PREPARE_RESUME` is dead with "no base resume is available". The resume is one
PDF read from `BASE_RESUME_PDF`; nothing generates it, so this is always a path
that is wrong or a file that moved.

```bash
docker compose -f docker-compose.prod.yml run --rm worker internship-ops check-base-resume
```

That prints the path, the size, the checksum and the page count, and says
whether it has been imported. On the server the file must be inside the mounted
data directory — a path on your laptop will not exist in the container.

To retry a dead task after fixing the cause, re-queue the work rather than
resetting the row — the idempotency key means a second enqueue is free.

---

## "It says a draft was not created"

The outreach page lists the reason. Every one is a §8.2 rule:

- **not due until …** — two business days after submission, inside 09:30–15:30
  Eastern. Waiting is the fix.
- **recruiter contacted N days ago** — 30-day cooldown.
- **company already contacted N times** — two per company per 30 days.
- **daily limit reached** — three per day initially.
- **today is not a business day** — Saturday.

None of these is a bug, and none has an override. If you want to email someone
now, email them; this system is for the ones you would otherwise not get to.

---

## Live review will not open

The link is minted when you open the application page and lasts **30 minutes**.
An old link is refused on purpose.

Open the application again for a fresh one. If that fails too:

```bash
docker compose -f docker-compose.prod.yml ps browser-slot-1
docker compose -f docker-compose.prod.yml logs browser-slot-1 --tail 50
curl -s localhost:8080/health/ready
```

A slot with no recent heartbeat shows as such on the dashboard. Restart it:

```bash
docker compose -f docker-compose.prod.yml restart browser-slot-1
```

The application is not lost — a replay package was written while the page was
open. Set it to `READY_FOR_REPLAY` and the slot rebuilds it.

---

## The model budget is exhausted

```
Monthly LLM budget of $15.00 is spent
```

Spending is on **/settings**. The cap is real and survives restarts, which is the
point — a crash loop cannot spend it twice.

To raise it, change `LLM_MONTHLY_BUDGET_USD` and restart the worker. To find out
where it went:

```sql
SELECT date_trunc('day', created_at) AS day,
       round(sum((metadata->>'cost_usd')::numeric), 4) AS usd
FROM audit_events WHERE event_type = 'LLM_CHARGE'
GROUP BY 1 ORDER BY 1 DESC;
```

The deterministic parts of the pipeline keep working at zero budget. What stops
is scoring's AI components and hook generation.

---

## Gmail stopped working after about a week

The OAuth app is still in **Testing** publishing status. Google expires refresh
tokens after seven days in that mode, and the error reads like a bug in this code.

Google Cloud Console → *OAuth consent screen* → **Publishing status → In
production**, then re-run `scripts/gmail_authorize.py`. The unverified-app warning
on the consent screen is expected for a personal project.

---

## Restoring from backup

Backups are encrypted with `APP_ENCRYPTION_KEY` and verified when written, so a
backup that exists can be read — provided you still have the key. **If you lose
that key the backups are unreadable.** Keep it somewhere other than this machine.

```bash
ls -lh /data/internship-ops/backups/

python - <<'PY'
import base64, pathlib
from cryptography.fernet import Fernet
key = "YOUR_APP_ENCRYPTION_KEY"
material = base64.urlsafe_b64encode(key.encode().ljust(32, b"0")[:32])
blob = pathlib.Path("/data/internship-ops/backups/db-20260728T023000.sql.enc").read_bytes()
pathlib.Path("/tmp/restore.sql").write_bytes(Fernet(material).decrypt(blob))
PY

docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U internship_ops -d internship_ops < /tmp/restore.sql
rm /tmp/restore.sql        # it is a plaintext copy of everything
```

Verify a backup without restoring it:

```bash
uv run python -c "
from pathlib import Path
from app.config import get_settings
from app.services.backup import restore_check
s = get_settings()
p = sorted(Path(s.data_dir / 'backups').glob('db-*'))[-1]
print(p.name, 'readable:', restore_check(s, p, expect=b'--'))
"
```

---

## Rebuilding the machine

§17.1 warns that Always Free compute can be reclaimed. The design assumes it:

1. `terraform apply` a new instance. The data volume has `prevent_destroy` and
   survives.
2. Attach the existing volume to the new instance (change the attachment's
   `instance_id`, or attach it in the console).
3. `df -h /data` — cloud-init mounts it by UUID and will **not** reformat a disk
   that already has a filesystem.
4. Restore `.env` and `/data/internship-ops/secrets` from wherever you keep them.
5. `docker compose -f docker-compose.prod.yml up -d --build`

---

## Emergency stop

Nothing this system does is irreversible — it never submits and never sends. If
you want it to stop anyway:

```bash
docker compose -f docker-compose.prod.yml stop worker browser-slot-1 browser-slot-2
```

The web app keeps running, so you can still read everything. Queued work resumes
when you start the workers again; nothing is lost, because a task interrupted
mid-flight is reclaimed by the next worker after its lease expires.

---

## Things that look broken and are not

| Looks like | Actually |
|---|---|
| A job scored 88 and no application started | Selection is yours. A score is an invitation. |
| An application sat at READY_FOR_REVIEW all day | It waits for you. That is the whole design. |
| A draft exists but was never sent | Nothing here can send. The Gmail token has no send scope. |
| Sponsorship says AMBIGUOUS on an obvious posting | A restrictive verdict needs a verbatim quote. No quote, no verdict. |
| A recruiter was not matched for a company you have | Below the fuzzy threshold. Emailing the wrong company is worse than emailing nobody. |
| The worker logs "no handler for REPLAY_APPLICATION" | That handler lives in the browser slot, not the web worker. |
