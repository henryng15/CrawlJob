"""Backups and retention (spec §24, §23.6).

A backup of this database is a copy of every locked fact the user owns: their
legal name, their address, their citizenship, their demographic answers. So both
kinds are encrypted with the application key, and neither is written anywhere the
web container can read.

The restore check is part of the backup, not a separate ritual. §24.3 asks for a
monthly restore test; a test nobody remembers to run is not a test, so every dump
is verified immediately — decrypted, and its header checked — and a dump that
cannot be read back fails the task rather than sitting on disk looking like
insurance.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import shutil
import subprocess
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.config import Settings

__all__ = [
    "RETENTION",
    "BackupResult",
    "backup_artifacts",
    "backup_database",
    "prune",
    "restore_check",
]

log = logging.getLogger(__name__)

#: Absolute path, resolved once. A bare "pg_dump" would be found on PATH, and a
#: PATH an attacker can influence is a way to run anything as this process.
PG_DUMP = shutil.which("pg_dump") or "/usr/bin/pg_dump"

#: §24.4. Daily for a fortnight, weekly for two months. Enough to notice a
#: corruption that took a few days to be visible.
KEEP_DAILY = 14
KEEP_WEEKLY = 8

#: §23.6, as a table rather than prose so cleanup and the settings screen cannot
#: disagree about it.
RETENTION: dict[str, timedelta] = {
    "pre-submit": timedelta(days=30),
    "confirmation": timedelta(days=365),
    "storage-state": timedelta(days=7),
    "logs": timedelta(days=30),
}


@dataclass(frozen=True, slots=True)
class BackupResult:
    path: Path
    bytes_written: int
    sha256: str
    verified: bool
    pruned: int = 0

    def summary(self) -> str:
        size = self.bytes_written / 1_048_576
        state = "verified" if self.verified else "UNVERIFIED"
        return f"{self.path.name}: {size:.1f} MiB, {state}, {self.pruned} old file(s) removed"


def _fernet(settings: Settings):  # type: ignore[no-untyped-def]
    from cryptography.fernet import Fernet

    key = settings.app_encryption_key.get_secret_value()
    return Fernet(base64.urlsafe_b64encode(key.encode().ljust(32, b"0")[:32]))


def _backup_dir(settings: Settings) -> Path:
    directory = settings.data_dir / "backups"
    directory.mkdir(parents=True, exist_ok=True)
    # 0700: the backup contains everything the database contains.
    directory.chmod(0o700)
    return directory


def backup_database(settings: Settings, *, now: datetime | None = None) -> BackupResult:
    """Encrypted ``pg_dump``, verified by reading it back (§24.1, §24.3)."""
    moment = now or datetime.now(UTC)
    target = _backup_dir(settings) / f"db-{moment:%Y%m%dT%H%M%S}.sql.enc"

    dsn = str(settings.database_url).replace("postgresql+psycopg://", "postgresql://")
    with tempfile.NamedTemporaryFile(suffix=".sql", delete=True) as raw:
        try:
            subprocess.run(  # noqa: S603 - fixed argv, no shell
                [
                    PG_DUMP,
                    "--no-owner",
                    "--no-privileges",
                    "--format=plain",
                    "--file",
                    raw.name,
                    dsn,
                ],
                check=True,
                capture_output=True,
                timeout=900,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                "pg_dump is not installed in this image. Add postgresql-client to "
                "docker/worker.Dockerfile."
            ) from exc
        except subprocess.CalledProcessError as exc:
            # stderr, not stdout: the dump itself went to a file, and the error is
            # the only thing worth surfacing. It does not contain the password —
            # the DSN is passed as an argument, and pg_dump does not echo it.
            raise RuntimeError(f"pg_dump failed: {exc.stderr.decode()[-500:]}") from exc

        plaintext = Path(raw.name).read_bytes()

    return _write_encrypted(settings, target, plaintext, expect=b"--")


def backup_artifacts(settings: Settings, *, now: datetime | None = None) -> BackupResult:
    """Encrypted tar of resumes and screenshots (§24.2)."""
    moment = now or datetime.now(UTC)
    target = _backup_dir(settings) / f"artifacts-{moment:%Y%m%dT%H%M%S}.tar.enc"

    artifacts = settings.artifacts_dir
    artifacts.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".tar", delete=True) as raw:
        with tarfile.open(raw.name, "w") as archive:
            archive.add(artifacts, arcname="artifacts")
        plaintext = Path(raw.name).read_bytes()

    return _write_encrypted(settings, target, plaintext, expect=None)


def _write_encrypted(
    settings: Settings, target: Path, plaintext: bytes, *, expect: bytes | None
) -> BackupResult:
    fernet = _fernet(settings)
    target.write_bytes(fernet.encrypt(plaintext))
    target.chmod(0o600)

    verified = restore_check(settings, target, expect=expect)
    if not verified:
        # Better no backup than a backup believed to work. Deleting it means the
        # next run tries again instead of the directory filling with rubble.
        target.unlink(missing_ok=True)
        raise RuntimeError(f"{target.name} could not be read back; the backup was discarded")

    return BackupResult(
        path=target,
        bytes_written=target.stat().st_size,
        sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
        verified=verified,
        pruned=prune(_backup_dir(settings), prefix=target.name.split("-")[0]),
    )


def restore_check(settings: Settings, path: Path, *, expect: bytes | None = None) -> bool:
    """Decrypt a backup and confirm it looks like what it claims to be.

    Not a full restore into a scratch database — that needs a server this process
    may not have — but it catches the failures that actually happen: a wrong key,
    a truncated write, a dump that is empty because ``pg_dump`` failed quietly.
    """
    from cryptography.fernet import InvalidToken

    try:
        plaintext = _fernet(settings).decrypt(path.read_bytes())
    except (InvalidToken, OSError):
        log.exception("could not decrypt %s", path)
        return False

    if not plaintext:
        return False
    return plaintext.lstrip().startswith(expect) if expect else True


def prune(directory: Path, *, prefix: str) -> int:
    """Keep 14 daily and 8 weekly backups; delete the rest (§24.4)."""
    files = sorted(
        (p for p in directory.glob(f"{prefix}-*") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    keep: set[Path] = set(files[:KEEP_DAILY])
    weeks_seen: set[str] = set()
    for path in files[KEEP_DAILY:]:
        stamp = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
        week = f"{stamp.isocalendar().year}-{stamp.isocalendar().week}"
        if week not in weeks_seen and len(weeks_seen) < KEEP_WEEKLY:
            weeks_seen.add(week)
            keep.add(path)

    removed = 0
    for path in files:
        if path not in keep:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def expire_artifacts(settings: Settings, *, now: datetime | None = None) -> dict[str, int]:
    """Delete artifacts past their retention window (§23.6).

    The retention table on the settings screen is a promise. Displaying it while
    deleting nothing would make it a false one.
    """
    moment = now or datetime.now(UTC)
    removed: dict[str, int] = {}

    for label, age in RETENTION.items():
        cutoff = moment - age
        count = 0
        for path in settings.artifacts_dir.rglob(f"*{label}*"):
            if not path.is_file():
                continue
            modified = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
            if modified < cutoff:
                path.unlink(missing_ok=True)
                count += 1
        removed[label] = count

    return removed


def free_bytes(path: Path) -> int:
    """Space left on the volume holding ``path``. Surfaced on the health page."""
    usage = shutil.disk_usage(path if path.exists() else path.parent)
    return int(usage.free)


def is_writable(path: Path) -> bool:
    return os.access(path if path.exists() else path.parent, os.W_OK)
