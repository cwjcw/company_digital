"""Read-only E10 item adapter for KDOS研发中心.

Credentials and connection settings are loaded only by the shared basic_code
MSSQLDatabase utility. This process emits NDJSON and never executes source
writes or DDL.
"""
import argparse, json, os, sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(os.getenv("RD_BASIC_CODE_ROOT", "/data/automation/code/work/basci/basic_code"))
sys.path.insert(0, str(ROOT))
from sql_server import MSSQLDatabase  # noqa: E402
import pytds  # noqa: E402


def value(v):
    if isinstance(v, (bytes, bytearray)):
        return v.decode("gb18030", "replace")
    if v is None:
        return None
    if hasattr(v, "hex") and type(v).__name__ == "UUID":
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat(sep=" ")
    return v


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("FULL", "INCREMENTAL"), required=True)
    parser.add_argument("--since-at")
    parser.add_argument("--since-id")
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 10000:
        raise ValueError("invalid batch size")
    config = MSSQLDatabase(autoconnect=False)
    connection = pytds.connect(server=config.server, port=int(config.port), database=config.database,
                                user=config.user, password=config.password, timeout=60, login_timeout=30,
                                bytes_to_unicode=False, readonly=True)
    try:
        cursor = connection.cursor()
        last_at = None
        last_id = None
        while True:
            clauses = []
            if args.mode == "INCREMENTAL" and args.since_at:
                since = datetime.fromisoformat(args.since_at.replace("Z", "+00:00")).replace(tzinfo=None) - timedelta(minutes=2)
                literal = since.strftime("%Y-%m-%d %H:%M:%S.%f")
                clauses.append(f"(i.LastModifiedDate > CONVERT(datetime2(6), '{literal}', 121) OR (i.LastModifiedDate = CONVERT(datetime2(6), '{literal}', 121) AND CONVERT(varchar(36), i.ITEM_BUSINESS_ID) > '{args.since_id or ''}'))")
            if last_at is not None:
                literal = last_at.strftime("%Y-%m-%d %H:%M:%S.%f")
                clauses.append(f"(i.LastModifiedDate > CONVERT(datetime2(6), '{literal}', 121) OR (i.LastModifiedDate = CONVERT(datetime2(6), '{literal}', 121) AND CONVERT(varchar(36), i.ITEM_BUSINESS_ID) > '{last_id}'))")
            where = " WHERE " + " AND ".join(clauses) if clauses else ""
            sql = f"""
              SELECT TOP {args.batch_size}
                CONVERT(varchar(36), i.ITEM_BUSINESS_ID) source_id, i.ITEM_CODE item_code,
                i.ITEM_NAME item_name, i.ITEM_SPECIFICATION specification, i.REMARK remark,
                CAST(NULL AS bit) is_group_item, i.STATUS status, i.ApproveStatus approve_status,
                i.CreateDate created_at_source, i.LastModifiedDate last_modified_at_source, i.ModifiedDate modified_at_source,
                CONVERT(varchar(36), i.CreateBy) created_by_source, CONVERT(varchar(36), i.LastModifiedBy) last_modified_by_source,
                CONVERT(varchar(36), i.ModifiedBy) modified_by_source,
                COALESCE(uc.USER_NAME, ec.EMPLOYEE_NAME) created_by_name,
                COALESCE(ul.USER_NAME, el.EMPLOYEE_NAME) last_modified_by_name,
                COALESCE(um.USER_NAME, em.EMPLOYEE_NAME) modified_by_name
              FROM dbo.ITEM i
              LEFT JOIN dbo.[USER] uc ON uc.USER_ID=i.CreateBy LEFT JOIN dbo.EMPLOYEE ec ON ec.EMPLOYEE_ID=uc.EMPLOYEE_ID
              LEFT JOIN dbo.[USER] ul ON ul.USER_ID=i.LastModifiedBy LEFT JOIN dbo.EMPLOYEE el ON el.EMPLOYEE_ID=ul.EMPLOYEE_ID
              LEFT JOIN dbo.[USER] um ON um.USER_ID=i.ModifiedBy LEFT JOIN dbo.EMPLOYEE em ON em.EMPLOYEE_ID=um.EMPLOYEE_ID
              {where}
              ORDER BY i.LastModifiedDate, i.ITEM_BUSINESS_ID
            """
            cursor.execute(sql)
            columns = [item[0] for item in cursor.description or []]
            rows = [dict(zip(columns, [value(item) for item in row])) for row in cursor.fetchall()]
            if not rows:
                break
            for row in rows:
                print(json.dumps(row, ensure_ascii=False), flush=True)
            last = rows[-1]
            last_at = datetime.fromisoformat(str(last["last_modified_at_source"]))
            last_id = str(last["source_id"])
            if len(rows) < args.batch_size:
                break
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
