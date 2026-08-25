import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from .api_client import ContactSyncApi


def prune_backups(root: Path, retention_days: int) -> list[str]:
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    cutoff = datetime.now().astimezone() - timedelta(days=retention_days)
    removed: list[str] = []
    for candidate in root.iterdir():
        if not candidate.is_dir():
            continue
        modified = datetime.fromtimestamp(candidate.stat().st_mtime).astimezone()
        if modified < cutoff:
            shutil.rmtree(candidate)
            removed.append(candidate.name)
    return removed


def backup_local_state(api: ContactSyncApi, root: Path, retention_days: int) -> tuple[Path, list[str]]:
    removed = prune_backups(root, retention_days)
    target = root / datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    target.mkdir(parents=True, exist_ok=False)
    target.chmod(0o700)
    snapshot = api.backup_snapshot()
    snapshot_file = target / "local-before-sync.json"
    snapshot_file.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    snapshot_file.chmod(0o600)
    return target, removed
