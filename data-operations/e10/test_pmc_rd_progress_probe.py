import unittest
from datetime import datetime, timedelta

from pmc_rd_progress_probe import (
    BomCandidate,
    BomDetail,
    ComponentStatus,
    RdStatus,
    RoutingCandidate,
    RoutingDetail,
    ZERO_GUID,
    calculate_rd_status,
    candidate_summary,
    determine_item_rule,
    evaluate_design_bom,
    evaluate_routing,
    normalize_guid,
    parse_as_of,
    summarize_order,
)


AS_OF = datetime(2026, 10, 6, 12, 0, 0)


def bom(
    identity="bom-1",
    *,
    approve="Y",
    detail_approve="Y",
    effective=None,
    expiry=None,
):
    return BomCandidate(
        bom_id=identity,
        item_id="item-1",
        owner_org_id="plant-1",
        version_times="0000",
        e_code="P",
        approve_status=approve,
        details=[
            BomDetail(
                bom_detail_id=f"{identity}-detail",
                approve_status=detail_approve,
                effective_date=effective or AS_OF - timedelta(days=1),
                expiry_date=expiry or AS_OF + timedelta(days=1),
            )
        ],
    )


def route(
    identity="route-1",
    *,
    item_id="item-1",
    approve="Y",
    detail_approve="Y",
    operation_id="operation-1",
    operation_exists=True,
    details=True,
):
    routing = RoutingCandidate(
        routing_id=identity,
        item_id=item_id,
        owner_org_id="plant-1",
        item_feature_id=None,
        routing_code="1000000",
        approve_status=approve,
    )
    if details:
        routing.details.append(
            RoutingDetail(
                routing_detail_id=f"{identity}-detail",
                approve_status=detail_approve,
                operation_id=operation_id,
                operation_exists=operation_exists,
            )
        )
    return routing


class GuidNormalizationTests(unittest.TestCase):
    def test_zero_guid_and_blank_are_none(self):
        self.assertIsNone(normalize_guid(None))
        self.assertIsNone(normalize_guid(""))
        self.assertIsNone(normalize_guid(ZERO_GUID.upper()))

    def test_real_guid_is_normalized(self):
        self.assertEqual(
            normalize_guid("6FEE95FC-CD25-46A3-AC94-1BE37EFEB273"),
            "6fee95fc-cd25-46a3-ac94-1be37efeb273",
        )

    def test_as_of_with_timezone_is_normalized_to_shanghai_wall_time(self):
        self.assertEqual(
            parse_as_of("2026-10-06T04:00:00Z"),
            datetime(2026, 10, 6, 12, 0, 0),
        )


class DesignBomTests(unittest.TestCase):
    def test_no_bom_is_not_started(self):
        result = evaluate_design_bom([], AS_OF)
        self.assertEqual(result.status, ComponentStatus.NOT_STARTED)
        self.assertEqual(result.reason_code, "NO_BOM")

    def test_unapproved_bom_is_in_progress(self):
        result = evaluate_design_bom([bom(approve="N")], AS_OF)
        self.assertEqual(result.status, ComponentStatus.IN_PROGRESS)
        self.assertEqual(result.reason_code, "BOM_NOT_APPROVED")

    def test_approved_bom_without_approved_detail_is_in_progress(self):
        result = evaluate_design_bom([bom(detail_approve="N")], AS_OF)
        self.assertEqual(result.status, ComponentStatus.IN_PROGRESS)
        self.assertEqual(result.reason_code, "BOM_NO_APPROVED_DETAILS")

    def test_approved_bom_without_current_detail_is_in_progress(self):
        result = evaluate_design_bom(
            [bom(effective=AS_OF + timedelta(seconds=1))], AS_OF
        )
        self.assertEqual(result.status, ComponentStatus.IN_PROGRESS)
        self.assertEqual(result.reason_code, "NO_EFFECTIVE_BOM_DETAIL")

    def test_effective_date_boundaries_are_inclusive(self):
        result = evaluate_design_bom(
            [bom(effective=AS_OF, expiry=AS_OF)], AS_OF
        )
        self.assertEqual(result.status, ComponentStatus.COMPLETE)
        self.assertEqual(result.valid_count, 1)

    def test_multiple_active_boms_are_abnormal(self):
        result = evaluate_design_bom([bom("bom-1"), bom("bom-2")], AS_OF)
        self.assertEqual(result.status, ComponentStatus.ABNORMAL)
        self.assertEqual(result.reason_code, "MULTIPLE_ACTIVE_BOMS")


class RoutingTests(unittest.TestCase):
    def test_control_zero_is_not_applicable(self):
        result = evaluate_routing("0", None, [], {})
        self.assertEqual(result.status, ComponentStatus.NOT_APPLICABLE)

    def test_unapproved_route_is_in_progress(self):
        candidate = route(approve="N")
        result = evaluate_routing("1", None, [candidate], {candidate.routing_id: candidate})
        self.assertEqual(result.status, ComponentStatus.IN_PROGRESS)
        self.assertEqual(result.reason_code, "ROUTING_NOT_APPROVED")

    def test_route_without_approved_operation_is_in_progress(self):
        candidate = route(detail_approve="N")
        result = evaluate_routing("1", None, [candidate], {candidate.routing_id: candidate})
        self.assertEqual(result.status, ComponentStatus.IN_PROGRESS)
        self.assertEqual(result.reason_code, "ROUTING_NO_APPROVED_OPERATIONS")

    def test_invalid_operation_reference_is_in_progress(self):
        candidate = route(operation_id=None, operation_exists=False)
        result = evaluate_routing("1", None, [candidate], {candidate.routing_id: candidate})
        self.assertEqual(result.status, ComponentStatus.IN_PROGRESS)
        self.assertEqual(result.reason_code, "INVALID_OPERATION_REFERENCE")

    def test_standard_route_may_reference_another_item(self):
        candidate = route(item_id="shared-route-owner")
        result = evaluate_routing(
            "1", candidate.routing_id, [], {candidate.routing_id: candidate}
        )
        self.assertEqual(result.status, ComponentStatus.COMPLETE)
        self.assertEqual(result.source, "STANDARD_ROUTING_REFERENCE")

    def test_missing_standard_route_is_abnormal(self):
        result = evaluate_routing("1", "missing-route", [], {})
        self.assertEqual(result.status, ComponentStatus.ABNORMAL)
        self.assertEqual(result.reason_code, "STANDARD_ROUTING_NOT_FOUND")

    def test_multiple_approved_routes_without_standard_are_abnormal(self):
        first = route("route-1")
        second = route("route-2")
        result = evaluate_routing(
            "1", None, [first, second], {first.routing_id: first, second.routing_id: second}
        )
        self.assertEqual(result.status, ComponentStatus.ABNORMAL)
        self.assertEqual(result.reason_code, "MULTIPLE_ACTIVE_ROUTINGS")

    def test_control_two_is_abnormal_until_validated(self):
        result = evaluate_routing("2", None, [], {})
        self.assertEqual(result.status, ComponentStatus.ABNORMAL)
        self.assertEqual(result.reason_code, "UNSUPPORTED_FEATURE_ROUTING")


class FinalStatusTests(unittest.TestCase):
    def test_purchase_item_without_routing_is_not_applicable(self):
        rule = determine_item_rule("P", "0")
        design = evaluate_design_bom([], AS_OF)
        routing = evaluate_routing("0", None, [], {})
        result = calculate_rd_status(rule, design, routing)
        self.assertEqual(result.status, RdStatus.NOT_APPLICABLE)

    def test_unverified_property_control_combination_is_abnormal(self):
        rule = determine_item_rule("P", "1")
        result = calculate_rd_status(
            rule, evaluate_design_bom([], AS_OF), evaluate_routing("1", None, [], {})
        )
        self.assertEqual(result.status, RdStatus.ABNORMAL)
        self.assertEqual(result.reason_code, "UNSUPPORTED_ITEM_RULE_COMBINATION")

    def test_feature_routing_ambiguity_makes_final_status_abnormal(self):
        rule = determine_item_rule("M", "2")
        result = calculate_rd_status(
            rule, evaluate_design_bom([], AS_OF), evaluate_routing("2", None, [], {})
        )
        self.assertEqual(result.status, RdStatus.ABNORMAL)
        self.assertEqual(result.reason_code, "UNSUPPORTED_FEATURE_ROUTING")

    def test_self_made_without_bom_is_not_started(self):
        rule = determine_item_rule("M", "1")
        result = calculate_rd_status(
            rule, evaluate_design_bom([], AS_OF), evaluate_routing("1", None, [], {})
        )
        self.assertEqual(result.status, RdStatus.NOT_STARTED)

    def test_bom_in_progress_maps_to_design_in_progress(self):
        rule = determine_item_rule("M", "1")
        result = calculate_rd_status(
            rule,
            evaluate_design_bom([bom(approve="N")], AS_OF),
            evaluate_routing("1", None, [], {}),
        )
        self.assertEqual(result.status, RdStatus.DESIGN_IN_PROGRESS)

    def test_complete_bom_without_route_is_waiting_routing(self):
        rule = determine_item_rule("M", "1")
        result = calculate_rd_status(
            rule,
            evaluate_design_bom([bom()], AS_OF),
            evaluate_routing("1", None, [], {}),
        )
        self.assertEqual(result.status, RdStatus.WAITING_ROUTING)

    def test_incomplete_route_maps_to_routing_in_progress(self):
        rule = determine_item_rule("M", "1")
        candidate = route(approve="N")
        result = calculate_rd_status(
            rule,
            evaluate_design_bom([bom()], AS_OF),
            evaluate_routing("1", None, [candidate], {candidate.routing_id: candidate}),
        )
        self.assertEqual(result.status, RdStatus.ROUTING_IN_PROGRESS)

    def test_complete_design_and_route_are_complete(self):
        rule = determine_item_rule("M", "1")
        candidate = route()
        result = calculate_rd_status(
            rule,
            evaluate_design_bom([bom()], AS_OF),
            evaluate_routing(
                "1", candidate.routing_id, [], {candidate.routing_id: candidate}
            ),
        )
        self.assertEqual(result.status, RdStatus.COMPLETE)

    def test_order_summary_excludes_not_applicable_from_denominator(self):
        summary = summarize_order(
            [
                {"rdStatus": RdStatus.COMPLETE.value},
                {"rdStatus": RdStatus.NOT_APPLICABLE.value},
                {"rdStatus": RdStatus.WAITING_ROUTING.value},
            ]
        )
        self.assertEqual(summary["requiredItemCount"], 2)
        self.assertEqual(summary["completionRate"], "50.00%")
        self.assertEqual(summary["orderStatus"], "IN_PROGRESS")

    def test_candidate_summary_includes_zero_count_statuses_and_order_statuses(self):
        summary = candidate_summary(
            [
                {
                    "orderId": "order-1",
                    "orderNo": "SO-1",
                    "rdStatus": RdStatus.COMPLETE.value,
                    "reasonCode": "RD_COMPLETE",
                    "lineNumber": 1,
                    "orderLineId": "line-1",
                    "itemCode": "ITEM-1",
                    "itemProperty": "M",
                    "itemRoutingControl": "1",
                    "reasonText": "完成",
                }
            ],
            sample_per_status=1,
        )
        self.assertEqual(summary["statusCounts"]["COMPLETE"], 1)
        self.assertEqual(summary["statusCounts"]["DESIGN_IN_PROGRESS"], 0)
        self.assertEqual(summary["orderStatusCounts"]["COMPLETE"], 1)
        self.assertEqual(summary["orderStatusCounts"]["ABNORMAL"], 0)


if __name__ == "__main__":
    unittest.main()
