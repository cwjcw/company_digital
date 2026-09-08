import unittest

from automation.wecom_sync.wecom_snapshot import _normalize_organization_path


class OrganizationDisplayNormalizationTests(unittest.TestCase):
    def test_company_root_is_shortened_without_changing_children(self) -> None:
        self.assertEqual(
            _normalize_organization_path(["厦门凯南展示制品有限公司", "事业四部", "生产部"]),
            ["凯南", "事业四部", "生产部"],
        )

    def test_alternate_company_name_is_also_shortened(self) -> None:
        self.assertEqual(_normalize_organization_path(["凯南展示制品有限公司"]), ["凯南"])


if __name__ == "__main__":
    unittest.main()
