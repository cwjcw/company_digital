from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data" / "contact-sync"
BACKUP_DIR = DATA_DIR / "backups"
CREDENTIAL_FILE = DATA_DIR / "api-key"
LOCK_FILE = DATA_DIR / "sync.lock"
API_BASE_URL = "http://127.0.0.1:15172/api/v1"
BASIC_CODE_ROOT = Path("/data/automation/code/work/basci/basic_code")
BASIC_CODE_PYTHON = BASIC_CODE_ROOT / ".venv" / "bin" / "python"
BACKUP_RETENTION_DAYS = 3
