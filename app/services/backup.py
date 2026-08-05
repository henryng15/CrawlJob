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

**Nothing here ever holds an archive in memory.** The first version tarred the
artifacts tree, read the tar into a ``bytes``, encrypted that (Fernet returns
another copy, base64-expanded by ~37%), hashed a third copy and then decrypted a
fourth to verify it — five or six times the size of the tree, at a moment when no
container had a memory limit. At two applications a day that was invisible; at
fifty it is an OOM kill of the whole box. Both backups now stream: the archive is
gzipped as it is produced, encrypted a chunk at a time, hashed as it is written,
and verified by reading it back a chunk at a time. Peak memory is a few chunks
regardless of how large the tree gets.

Format
------
Fernet has no streaming API — :meth:`encrypt` takes the whole message — so the
file is a sequence of independently encrypted frames::

    magic      b"IOBK1\\n"
    stream id  16 random bytes
    frames     repeated: uint32 big-endian token length, then a Fernet token

and the plaintext inside each frame is::

    stream id (16 bytes) || sequence (uint64 BE) || kind (1 byte) || payload

``kind`` 0x00 carries one chunk of the gzip-compressed archive; 0x01 is the final
frame, and its payload is the total number of compressed bytes (uint64 BE).

Putting the stream id and the sequence number *inside* the authenticated
plaintext is what makes framing safe. Fernet authenticates each token on its own,
so without them someone holding the file could drop, reorder or duplicate frames
— or splice in frames from a different backup made with the same key — and every
individual token would still verify. With them, the reader rejects all four, and
a file that stops before its end frame is a truncation rather than a short
archive that looks complete.

Backups written before this change are a single Fernet token over an
uncompressed archive. They do not begin with the magic, and :func:`restore_check`
and :func:`decrypt_to` still read them the old way — whole-file, which is
acceptable for a file that is only read during an actual restore.
"""

from __future__ import annotations

import base64
import fnmatch
import gzip
import hashlib
import logging
import os
import secrets
import shutil
import struct
import subprocess
import tarfile
import tempfile
import zlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import IO, Any

from app.config import Settings

__all__ = [
    "RETENTION",
    "BackupResult",
    "backup_artifacts",
    "backup_database",
    "decrypt_to",
    "expire_artifacts",
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

#: Plaintext bytes per frame. Four mebibytes keeps the per-frame overhead
#: (16 + 8 + 1 bytes of binding, plus Fernet's own 73 and its base64 expansion)
#: down in the noise while keeping the working set small enough that a hundred
#: gigabytes of artifacts cost the same memory as one megabyte does.
CHUNK_BYTES = 4 * 1024 * 1024

#: Refuse to allocate for a length field a hostile file could have inflated.
#: Generous: a legitimate frame is CHUNK_BYTES plus a little over a third.
_MAX_FRAME_BYTES = 8 * CHUNK_BYTES

MAGIC = b"IOBK1\n"
_STREAM_ID_BYTES = 16
_LEN = struct.Struct(">I")
_SEQ = struct.Struct(">Q")
_KIND_DATA = b"\x00"
_KIND_END = b"\x01"
_BIND_BYTES = _STREAM_ID_BYTES + _SEQ.size + 1

#: zlib's flag for "this is a gzip stream, header and CRC included".
_GZIP_WBITS = 16 + zlib.MAX_WBITS

#: How much of the decompressed archive :func:`restore_check` keeps in order to
#: check the header. Only the first frame's worth is ever inspected.
_HEAD_BYTES = 64


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


# --------------------------------------------------------------- writing


class _FrameWriter:
    """A write-only stream that encrypts, frames and hashes as it goes.

    Handed to :mod:`tarfile` and :mod:`gzip` in place of a file, so the archive
    is never anywhere but in flight: at most one chunk of it exists at a time.
    """

    def __init__(self, sink: IO[bytes], fernet: Any, stream_id: bytes) -> None:
        self._sink = sink
        self._fernet = fernet
        self._stream_id = stream_id
        self._buffer = bytearray()
        self._seq = 0
        self._payload_bytes = 0
        self.digest = hashlib.sha256()
        self._put(MAGIC)
        self._put(stream_id)

    # tarfile's stream writer checks for these.
    def writable(self) -> bool:
        return True

    def write(self, data: bytes) -> int:
        self._buffer += data
        while len(self._buffer) >= CHUNK_BYTES:
            self._emit(_KIND_DATA, bytes(self._buffer[:CHUNK_BYTES]))
            del self._buffer[:CHUNK_BYTES]
        return len(data)

    def flush(self) -> None:
        """No-op: a partial chunk is emitted at :meth:`finish`.

        Flushing early would be correct but wasteful — gzip calls it, and each
        call would cost a frame's worth of Fernet overhead.
        """

    def finish(self) -> None:
        if self._buffer:
            self._emit(_KIND_DATA, bytes(self._buffer))
            self._buffer.clear()
        self._emit(_KIND_END, _SEQ.pack(self._payload_bytes))

    def _emit(self, kind: bytes, payload: bytes) -> None:
        plaintext = self._stream_id + _SEQ.pack(self._seq) + kind + payload
        token: bytes = self._fernet.encrypt(plaintext)
        self._seq += 1
        if kind == _KIND_DATA:
            self._payload_bytes += len(payload)
        self._put(_LEN.pack(len(token)))
        self._put(token)

    def _put(self, raw: bytes) -> None:
        self._sink.write(raw)
        self.digest.update(raw)


def _write_stream(settings: Settings, target: Path, fill: Callable[[_FrameWriter], None]) -> str:
    """Run *fill* against an encrypting writer aimed at *target*; return its sha256.

    The file is created 0600 rather than chmod-ed afterwards: between ``open``
    and ``chmod`` a backup would be world-readable, and it is a copy of every
    locked fact the user owns.
    """
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "wb") as sink:
            writer = _FrameWriter(sink, _fernet(settings), secrets.token_bytes(_STREAM_ID_BYTES))
            fill(writer)
            writer.finish()
            sink.flush()
            os.fsync(sink.fileno())
            return writer.digest.hexdigest()
    except BaseException:
        # A half-written backup is worse than none: it would be pruned as though
        # it were one of the fourteen dailies.
        target.unlink(missing_ok=True)
        raise


# --------------------------------------------------------------- reading


def _plaintext_chunks(settings: Settings, path: Path) -> Iterator[bytes]:
    """Yield the decompressed archive a chunk at a time.

    Raises rather than returning a flag: every failure here means the backup
    cannot be read, and the callers turn that into "not verified".
    """
    fernet = _fernet(settings)
    with path.open("rb") as handle:
        head = handle.read(len(MAGIC))
        if head != MAGIC:
            # Written before the streaming format: one token, one archive, no
            # compression. Read whole — it is only reached on an old file.
            yield fernet.decrypt(head + handle.read())
            return

        stream_id = handle.read(_STREAM_ID_BYTES)
        if len(stream_id) != _STREAM_ID_BYTES:
            raise ValueError("the backup header is truncated")

        decompressor = zlib.decompressobj(_GZIP_WBITS)
        expected_seq = 0
        payload_bytes = 0
        ended = False

        while not ended:
            size_field = handle.read(_LEN.size)
            if not size_field:
                break
            if len(size_field) != _LEN.size:
                raise ValueError("the backup ends inside a frame header")
            (size,) = _LEN.unpack(size_field)
            if size == 0 or size > _MAX_FRAME_BYTES:
                raise ValueError(f"implausible frame length {size}")
            token = handle.read(size)
            if len(token) != size:
                raise ValueError("the backup ends inside a frame")

            frame = fernet.decrypt(token)
            if len(frame) < _BIND_BYTES:
                raise ValueError("a frame is too short to be one of ours")
            if frame[:_STREAM_ID_BYTES] != stream_id:
                raise ValueError("a frame belongs to a different backup")
            (seq,) = _SEQ.unpack(frame[_STREAM_ID_BYTES : _STREAM_ID_BYTES + _SEQ.size])
            if seq != expected_seq:
                raise ValueError(f"frame {seq} arrived where {expected_seq} was expected")
            expected_seq += 1

            kind = frame[_BIND_BYTES - 1 : _BIND_BYTES]
            payload = frame[_BIND_BYTES:]
            if kind == _KIND_END:
                if len(payload) != _SEQ.size or _SEQ.unpack(payload)[0] != payload_bytes:
                    raise ValueError("the end frame disagrees about how long the backup is")
                ended = True
                break
            if kind != _KIND_DATA:
                raise ValueError(f"unknown frame kind {kind!r}")

            payload_bytes += len(payload)
            chunk = decompressor.decompress(payload)
            if chunk:
                yield chunk

        if not ended:
            raise ValueError("the backup has no end frame, so it was truncated")
        tail = decompressor.flush()
        if tail:
            yield tail
        if not decompressor.eof:
            # The gzip trailer carries a CRC and a length; not reaching it means
            # the compressed stream itself is incomplete.
            raise ValueError("the compressed stream is incomplete")


def restore_check(settings: Settings, path: Path, *, expect: bytes | None = None) -> bool:
    """Decrypt a backup and confirm it looks like what it claims to be.

    Not a full restore into a scratch database — that needs a server this process
    may not have — but it catches the failures that actually happen: a wrong key,
    a truncated write, a dump that is empty because ``pg_dump`` failed quietly.

    Every frame is decrypted and every compressed byte decompressed, so this is a
    real end-to-end read; only the first :data:`_HEAD_BYTES` are kept.
    """
    from cryptography.fernet import InvalidToken

    head = b""
    size = 0
    try:
        for chunk in _plaintext_chunks(settings, path):
            size += len(chunk)
            if len(head) < _HEAD_BYTES:
                head += chunk[: _HEAD_BYTES - len(head)]
    except (InvalidToken, OSError, ValueError, EOFError, zlib.error, struct.error):
        log.exception("could not decrypt %s", path)
        return False

    if not size:
        return False
    return head.lstrip().startswith(expect) if expect else True


def decrypt_to(settings: Settings, source: Path, destination: Path) -> int:
    """Write the decrypted, decompressed archive to *destination*. Streaming.

    The restore path for a human (see docs/RUNBOOK.md): the result is a plain
    ``.tar`` or ``.sql``, and it is written 0600 because for the moment it exists
    it is the database in the clear.
    """
    written = 0
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as out:
        for chunk in _plaintext_chunks(settings, source):
            out.write(chunk)
            written += len(chunk)
    return written


# --------------------------------------------------------------- backups


def backup_database(settings: Settings, *, now: datetime | None = None) -> BackupResult:
    """Encrypted, compressed ``pg_dump``, verified by reading it back (§24.1, §24.3)."""
    moment = now or datetime.now(UTC)
    target = _backup_dir(settings) / f"db-{moment:%Y%m%dT%H%M%S}.sql.gz.enc"

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

        def fill(writer: _FrameWriter) -> None:
            # mtime=0: the timestamp is already in the filename, and a gzip
            # header that changes every run makes two identical dumps look
            # different to anything comparing hashes.
            with (
                gzip.GzipFile(fileobj=writer, mode="wb", mtime=0) as compressed,
                open(raw.name, "rb") as dump,
            ):
                shutil.copyfileobj(dump, compressed, length=1024 * 1024)

        return _finish(settings, target, fill, expect=b"--")


def backup_artifacts(settings: Settings, *, now: datetime | None = None) -> BackupResult:
    """Encrypted, compressed tar of resumes and screenshots (§24.2)."""
    moment = now or datetime.now(UTC)
    target = _backup_dir(settings) / f"artifacts-{moment:%Y%m%dT%H%M%S}.tar.gz.enc"

    artifacts = settings.artifacts_dir
    artifacts.mkdir(parents=True, exist_ok=True)

    def fill(writer: _FrameWriter) -> None:
        # "w|gz" is tarfile's *stream* mode: it never seeks and never buffers the
        # archive, handing the compressor one file block at a time. "w:gz" would
        # be the same archive built in a way that requires a real file.
        with tarfile.open(fileobj=writer, mode="w|gz") as archive:  # type: ignore[call-overload]
            archive.add(artifacts, arcname="artifacts")

    return _finish(settings, target, fill, expect=None)


def _finish(
    settings: Settings,
    target: Path,
    fill: Callable[[_FrameWriter], None],
    *,
    expect: bytes | None,
) -> BackupResult:
    digest = _write_stream(settings, target, fill)

    verified = restore_check(settings, target, expect=expect)
    if not verified:
        # Better no backup than a backup believed to work. Deleting it means the
        # next run tries again instead of the directory filling with rubble.
        target.unlink(missing_ok=True)
        raise RuntimeError(f"{target.name} could not be read back; the backup was discarded")

    return BackupResult(
        path=target,
        bytes_written=target.stat().st_size,
        sha256=digest,
        verified=verified,
        pruned=prune(_backup_dir(settings), prefix=target.name.split("-")[0]),
    )


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


# ------------------------------------------------------------- retention


def _artifacts_root(settings: Settings) -> Path:
    return settings.artifacts_dir


def _sessions_root(settings: Settings) -> Path:
    """Where browser sessions used to be saved, one file per application.

    Nothing writes here any more: each application now gets a fresh context that
    is thrown away when the page closes, so there are no cookies to keep. The
    sweep stays because deployments that ran the old code still have the files,
    and those files are live credentials.
    """
    return settings.data_dir / "browser-sessions"


@dataclass(frozen=True, slots=True)
class _Sweep:
    """One row of §23.6, expressed as something that can actually find files.

    ``age`` of ``None`` means "keep until the user deletes it" — the rule still
    exists so that the file is claimed by a rule and does not show up in the
    "matched no rule" count, which is how the next artifact nobody thought about
    gets noticed.
    """

    label: str
    age: timedelta | None
    root: Callable[[Settings], Path]
    patterns: tuple[str, ...]


#: §23.6, as a table rather than prose so cleanup and the settings screen cannot
#: disagree about it. Patterns match the path *relative to the rule's root*, in
#: order, first match wins — so the keep-for-ever resume rule is stated before
#: anything that could also match a PDF.
_SWEEPS: tuple[_Sweep, ...] = (
    # §23.6: "Tailored resumes — indefinite until user deletes". The copy in the
    # application's folder is what proves which bytes the employer received; a
    # hash in the database with no file behind it proves nothing. ~280 KB per
    # application, so a hundred a day is about 10 GB a year on a 100 GB volume —
    # affordable, and the honest place to save it is deduplication (every one of
    # these is a byte-for-byte copy of the same base PDF today), not deletion.
    _Sweep("resume", None, _artifacts_root, ("*/resume/*",)),
    # §23.6: 30 days. A picture of the filled form, which is only useful while
    # the user might still be asking "what did it put in that box".
    _Sweep("pre-submit", timedelta(days=30), _artifacts_root, ("*pre-submit*.png",)),
    # §23.6: 12 months. Nothing writes one today — a confirmation is a database
    # column, not a screenshot — so this rule currently matches nothing. It is
    # kept rather than deleted because the settings screen promises the window,
    # a single pass over the tree costs the same with it as without, and the day
    # someone captures a confirmation it is swept without anyone remembering to
    # come back here.
    _Sweep("confirmation", timedelta(days=365), _artifacts_root, ("*confirmation*.png",)),
    # Not in §23.6 at all, because §23.6 was written before the replay package
    # existed. It is every answer that went into the form, in plain JSON —
    # address, work authorisation, whatever EEO questions were asked — so it is
    # the most sensitive thing in the tree and the least defensible to keep for
    # ever. Thirty days: the same window as the screenshot of the same data, far
    # past the 24-hour prepared-application TTL, and long enough that restoring
    # an expired application still works for a month. Losing it later is handled
    # — ``check_restorable`` says so in words, and offers to prepare again.
    _Sweep("replay", timedelta(days=30), _artifacts_root, ("*replay.json",)),
    # §23.6: "Browser storage state — delete 7 days after submission". Cookies
    # and local storage for a logged-in ATS account: a live credential, and the
    # one artifact whose retention is a security decision rather than a disk one.
    # Timed from mtime, which is the moment the state was saved — at or after the
    # submission it belongs to, so this can only ever delete early, never late.
    _Sweep("storage-state", timedelta(days=7), _sessions_root, ("*.json",)),
)

#: The public promise, derived from the rules so the two cannot drift. Only rules
#: with a window appear: "until you delete it" is not a retention period.
RETENTION: dict[str, timedelta] = {s.label: s.age for s in _SWEEPS if s.age is not None}


def _matches(sweep: _Sweep, relative: str) -> bool:
    return any(fnmatch.fnmatch(relative, pattern) for pattern in sweep.patterns)


def expire_artifacts(settings: Settings, *, now: datetime | None = None) -> dict[str, int]:
    """Delete artifacts past their retention window (§23.6).

    The retention table on the settings screen is a promise. Displaying it while
    deleting nothing would make it a false one.

    One walk per root rather than one glob per rule: at fifty applications a day
    the tree is tens of thousands of directories within a year, and the number of
    rules should not multiply the cost of the nightly sweep.
    """
    moment = now or datetime.now(UTC)
    removed: dict[str, int] = dict.fromkeys(RETENTION, 0)

    for root_of in dict.fromkeys(sweep.root for sweep in _SWEEPS):
        root = root_of(settings)
        if not root.is_dir():
            continue
        rules = [sweep for sweep in _SWEEPS if sweep.root is root_of]
        unclaimed = 0

        for directory, _, names in os.walk(root):
            for name in names:
                path = Path(directory) / name
                relative = path.relative_to(root).as_posix()
                sweep = next((rule for rule in rules if _matches(rule, relative)), None)
                if sweep is None:
                    unclaimed += 1
                    continue
                if sweep.age is None:
                    continue
                try:
                    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
                except OSError:  # pragma: no cover - raced with another sweep
                    continue
                if modified < moment - sweep.age:
                    path.unlink(missing_ok=True)
                    removed[sweep.label] += 1

        if unclaimed:
            # Every artifact that no rule claims is one that grows for ever. This
            # is the log line that would have caught replay.json.
            log.info("%d file(s) under %s match no retention rule", unclaimed, root)

    return removed
