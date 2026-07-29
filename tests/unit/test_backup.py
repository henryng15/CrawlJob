"""Backups and retention (spec §24, §23.6).

The failure these guard against is not "the backup did not run" — that is
visible. It is "the backup ran for six months and none of them can be read",
which is invisible until the day it matters.
"""

from __future__ import annotations

import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.config import Settings
from app.services.backup import (
    KEEP_DAILY,
    RETENTION,
    backup_artifacts,
    expire_artifacts,
    prune,
    restore_check,
)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="backup-tests",
        app_encryption_key="a-real-encryption-key-for-tests",
        data_dir=tmp_path / "data",
    )


class TestArtifactBackup:
    def test_it_writes_an_encrypted_archive(self, settings: Settings):
        settings.artifacts_dir.mkdir(parents=True)
        (settings.artifacts_dir / "resume.pdf").write_bytes(b"%PDF-1.7 pretend")

        result = backup_artifacts(settings)
        assert result.path.exists()
        assert result.verified

    def test_the_archive_is_not_readable_as_plain_tar(self, settings: Settings):
        """A backup holds every locked fact the user owns."""
        settings.artifacts_dir.mkdir(parents=True)
        (settings.artifacts_dir / "resume.pdf").write_bytes(b"%PDF-1.7 secret")

        result = backup_artifacts(settings)
        raw = result.path.read_bytes()
        assert b"secret" not in raw
        assert not raw.startswith(b"resume")

    def test_it_round_trips(self, settings: Settings):
        settings.artifacts_dir.mkdir(parents=True)
        (settings.artifacts_dir / "resume.pdf").write_bytes(b"%PDF-1.7 content")

        result = backup_artifacts(settings)
        assert restore_check(settings, result.path)

    def test_the_directory_is_owner_only(self, settings: Settings):
        settings.artifacts_dir.mkdir(parents=True)
        result = backup_artifacts(settings)
        assert oct(result.path.stat().st_mode)[-3:] == "600"
        assert oct(result.path.parent.stat().st_mode)[-3:] == "700"

    def test_another_key_cannot_read_it(self, settings: Settings):
        """Which is what makes the encryption worth doing."""
        settings.artifacts_dir.mkdir(parents=True)
        result = backup_artifacts(settings)

        wrong = settings.model_copy(update={"app_encryption_key": settings.app_secret_key})
        assert not restore_check(wrong, result.path)

    def test_a_truncated_backup_fails_verification(self, settings: Settings):
        """Fernet is authenticated, so a half-written file is detected."""
        settings.artifacts_dir.mkdir(parents=True)
        result = backup_artifacts(settings)
        result.path.write_bytes(result.path.read_bytes()[:-20])

        assert not restore_check(settings, result.path)

    def test_a_missing_file_is_not_a_valid_backup(self, settings: Settings):
        assert not restore_check(settings, settings.data_dir / "nothing.enc")


class TestPruning:
    def _make(self, directory: Path, count: int, *, prefix: str = "db") -> None:
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(count):
            path = directory / f"{prefix}-{index:03d}.sql.enc"
            path.write_bytes(b"x")
            # Distinct mtimes, oldest first, one day apart.
            stamp = time.time() - (count - index) * 86400
            os.utime(path, (stamp, stamp))

    def test_recent_backups_are_kept(self, tmp_path: Path):
        self._make(tmp_path, 20)
        prune(tmp_path, prefix="db")
        assert len(list(tmp_path.glob("db-*"))) >= KEEP_DAILY

    def test_old_backups_are_removed(self, tmp_path: Path):
        self._make(tmp_path, 60)
        removed = prune(tmp_path, prefix="db")
        assert removed > 0
        assert len(list(tmp_path.glob("db-*"))) < 60

    def test_one_per_week_survives_beyond_the_daily_window(self, tmp_path: Path):
        """§24.4 keeps weeklies so a corruption noticed late is still recoverable."""
        self._make(tmp_path, 60)
        prune(tmp_path, prefix="db")
        assert len(list(tmp_path.glob("db-*"))) > KEEP_DAILY

    def test_other_prefixes_are_untouched(self, tmp_path: Path):
        self._make(tmp_path, 30, prefix="db")
        self._make(tmp_path, 5, prefix="artifacts")
        prune(tmp_path, prefix="db")
        assert len(list(tmp_path.glob("artifacts-*"))) == 5

    def test_pruning_an_empty_directory_is_fine(self, tmp_path: Path):
        assert prune(tmp_path, prefix="db") == 0


class TestRetention:
    def test_an_old_pre_submit_screenshot_is_deleted(self, settings: Settings):
        """§23.6: 30 days. The settings screen promises this."""
        directory = settings.artifacts_dir / "app-1"
        directory.mkdir(parents=True)
        old = directory / "pre-submit.png"
        old.write_bytes(b"png")
        stale = time.time() - RETENTION["pre-submit"].total_seconds() - 86400
        os.utime(old, (stale, stale))

        expire_artifacts(settings)
        assert not old.exists()

    def test_a_recent_screenshot_is_kept(self, settings: Settings):
        directory = settings.artifacts_dir / "app-1"
        directory.mkdir(parents=True)
        recent = directory / "pre-submit.png"
        recent.write_bytes(b"png")

        expire_artifacts(settings)
        assert recent.exists()

    def test_a_confirmation_screenshot_outlives_a_pre_submit_one(self, settings: Settings):
        """Different windows: a confirmation is evidence you applied."""
        directory = settings.artifacts_dir / "app-1"
        directory.mkdir(parents=True)
        pre = directory / "pre-submit.png"
        confirmation = directory / "confirmation.png"
        for path in (pre, confirmation):
            path.write_bytes(b"png")
            stale = time.time() - timedelta(days=60).total_seconds()
            os.utime(path, (stale, stale))

        expire_artifacts(settings)
        assert not pre.exists()
        assert confirmation.exists()

    def test_the_resume_is_never_deleted_by_retention(self, settings: Settings):
        """§23.6 keeps tailored resumes until the user deletes them."""
        directory = settings.artifacts_dir / "app-1"
        directory.mkdir(parents=True)
        resume = directory / "resume.pdf"
        resume.write_bytes(b"%PDF")
        stale = time.time() - timedelta(days=400).total_seconds()
        os.utime(resume, (stale, stale))

        expire_artifacts(settings)
        assert resume.exists()

    def test_it_reports_what_it_deleted(self, settings: Settings):
        settings.artifacts_dir.mkdir(parents=True)
        removed = expire_artifacts(settings, now=datetime.now(UTC))
        assert set(removed) == set(RETENTION)
