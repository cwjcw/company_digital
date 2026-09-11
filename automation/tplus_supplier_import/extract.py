#!/usr/bin/env python3
"""Extract T+ supplier master data into the KDOS canonical import contract."""

from __future__ import annotations

from contextlib import redirect_stdout
from hashlib import sha256
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from automation.customer_import.readers.common import flag, records, text  # noqa: E402
from automation.customer_import.readers.tplus import TPLUS_ACCOUNTS, TplusReader  # noqa: E402


QUERY = """
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT
  CONVERT(nvarchar(100), partner.id) sourceId,
  partner.code,
  partner.name,
  partner.partnerAbbName abbreviation,
  partner.shortHand shorthand,
  category.code categoryCode,
  category.name categoryName,
  CONVERT(int, partner.partnerType) partnerType,
  partner.representative,
  partner.Contact contact,
  partner.MobilePhone mobilePhone,
  partner.TelephoneNo telephone,
  partner.Fax fax,
  partner.EmailAddr email,
  COALESCE(
    NULLIF(LTRIM(RTRIM(partner.addressJC)), N''),
    NULLIF(LTRIM(RTRIM(partner.CheckAddress)), N''),
    NULLIF(LTRIM(RTRIM(partner.ShipmentAddress)), N'')
  ) address,
  CASE WHEN ISNULL(partner.disabled, 0) = 0 THEN 1 ELSE 0 END enabled,
  CONVERT(nvarchar(30), partner.updated, 126) sourceUpdatedAt
FROM dbo.AA_PartnerEntity partner
LEFT JOIN dbo.AA_PartnerClass category ON category.id = partner.idpartnerclass
WHERE partner.partnerType IN (226, 228)
ORDER BY partner.code, partner.id
"""


def supplier_rows() -> list[dict[str, object]]:
    reader = TplusReader(PROJECT_ROOT)
    result: list[dict[str, object]] = []
    for database in reader.databases:
        # The common database helper reports connection status to stdout. Keep stdout
        # reserved for the canonical JSON stream so it can be piped into the app command.
        with redirect_stdout(sys.stderr):
            source_rows = records(reader._database(database).get_from_query(QUERY))
        account = TPLUS_ACCOUNTS[database]
        for source in source_rows:
            partner_type = int(source["partnerType"])
            result.append({
                "sourceSystem": "TPLUS",
                "sourceDatabase": database,
                "sourceAccountName": account["name"],
                "sourceId": text(source.get("sourceId")),
                "code": text(source.get("code")),
                "name": text(source.get("name")),
                "abbreviation": text(source.get("abbreviation")),
                "shorthand": text(source.get("shorthand")),
                "categoryCode": text(source.get("categoryCode")),
                "categoryName": text(source.get("categoryName")),
                "partnerType": partner_type,
                "partnerTypeLabel": "供应商" if partner_type == 226 else "客户及供应商",
                "representative": text(source.get("representative")),
                "contact": text(source.get("contact")),
                "mobilePhone": text(source.get("mobilePhone")),
                "telephone": text(source.get("telephone")),
                "fax": text(source.get("fax")),
                "email": text(source.get("email")),
                "address": text(source.get("address")),
                "enabled": flag(source.get("enabled")),
                "sourceUpdatedAt": text(source.get("sourceUpdatedAt")),
            })
    return result


def main() -> None:
    rows = supplier_rows()
    stable = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = sha256(stable.encode("utf-8")).hexdigest()
    json.dump({"idempotencyKey": f"TPLUS-SUPPLIERS-{digest}", "rows": rows}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
