#!/usr/bin/env python3
"""Send a generated KDOS table preview through the Planning Center WeCom app."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


BASIC_CODE_ROOT = Path("/data/automation/code/work/basci/basic_code")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    parser.add_argument("--touser", required=True)
    args = parser.parse_args()
    if not args.file.is_file():
        raise SystemExit(f"文件不存在：{args.file}")

    sys.path.insert(0, str(BASIC_CODE_ROOT))
    from wechat import WeChatPusher

    response = WeChatPusher().send_app_file(str(args.file), touser=args.touser)
    print(json.dumps({
        "errcode": response.get("errcode"),
        "errmsg": response.get("errmsg"),
        "msgid": response.get("msgid"),
        "touser": args.touser,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
