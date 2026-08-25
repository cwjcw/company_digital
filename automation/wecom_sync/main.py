#!/data/automation/code/work/basci/basic_code/.venv/bin/python
import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from automation.wecom_sync.api_client import ContactSyncApi
    from automation.wecom_sync.backup import backup_local_state
    from automation.wecom_sync.config import API_BASE_URL, BACKUP_DIR, BACKUP_RETENTION_DAYS, CREDENTIAL_FILE, DATA_DIR, LOCK_FILE, PROJECT_ROOT
    from automation.wecom_sync.wecom_snapshot import export_live_snapshot, parse_snapshot
else:
    from .api_client import ContactSyncApi
    from .backup import backup_local_state
    from .config import API_BASE_URL, BACKUP_DIR, BACKUP_RETENTION_DAYS, CREDENTIAL_FILE, DATA_DIR, LOCK_FILE, PROJECT_ROOT
    from .wecom_snapshot import export_live_snapshot, parse_snapshot


def provision() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.chmod(0o700)
    command = [
        "docker", "compose", "run", "--rm", "--no-deps", "api", "node",
        "dist/modules/contact-sync/provision-contact-sync-key.js",
    ]
    completed = subprocess.run(command, cwd=PROJECT_ROOT, capture_output=True, text=True)
    if completed.returncode:
        detail = (completed.stderr or completed.stdout).strip()[-2000:]
        raise RuntimeError(f"创建同步 API Key 失败：{detail}")
    matches = re.findall(r"\{[^\n]*\}", completed.stdout)
    if not matches:
        raise RuntimeError(f"无法解析 API Key 创建结果：{completed.stdout[-500:]}")
    result = json.loads(matches[-1])
    temporary = CREDENTIAL_FILE.with_suffix(".tmp")
    temporary.write_text(result["apiKey"] + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(CREDENTIAL_FILE)
    return {"status": "provisioned", "credentialFile": str(CREDENTIAL_FILE), "apiKeyId": result["id"]}


def run_sync(dry_run: bool, source: Path | None) -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.chmod(0o700)
    LOCK_FILE.touch(mode=0o600, exist_ok=True)
    with LOCK_FILE.open("r+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("已有通讯录同步任务正在运行") from error
        api = ContactSyncApi(API_BASE_URL, CREDENTIAL_FILE)
        backup_target, removed = backup_local_state(api, BACKUP_DIR, BACKUP_RETENTION_DAYS)
        if source:
            if not dry_run:
                raise RuntimeError("历史 Excel 只允许用于 --dry-run，正式同步必须实时读取企业微信")
            workbook_path = source.resolve()
            department_paths = None
        else:
            workbook_path, department_paths = export_live_snapshot(backup_target / "Contacts_wechat.xlsx")
            workbook_path.chmod(0o600)
        payload = parse_snapshot(workbook_path, department_paths)
        payload_file = backup_target / "normalized-payload.json"
        payload_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        payload_file.chmod(0o600)
        result = api.sync(payload, dry_run=dry_run)
        manifest = {"result": result, "removedExpiredBackups": removed, "source": str(workbook_path)}
        result_file = backup_target / "result.json"
        result_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        result_file.chmod(0o600)
        return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="企业微信通讯录与 KDOS 每日同步")
    parser.add_argument("command", nargs="?", choices=["sync", "dry-run", "backup", "provision"], default="sync")
    parser.add_argument("--source", type=Path, help="仅 dry-run 可使用的历史 Contacts_wechat.xlsx")
    args = parser.parse_args()
    try:
        if args.command == "provision":
            result = provision()
        elif args.command == "backup":
            api = ContactSyncApi(API_BASE_URL, CREDENTIAL_FILE)
            target, removed = backup_local_state(api, BACKUP_DIR, BACKUP_RETENTION_DAYS)
            result = {"status": "backed-up", "target": str(target), "removedExpiredBackups": removed}
        else:
            result = run_sync(args.command == "dry-run", args.source)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(f"通讯录同步失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
