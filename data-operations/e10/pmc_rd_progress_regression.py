"""Offline Phase 3 oracle regression on the exact same captured source facts.
Never imported by the production reader/API.
"""
import argparse
import json
from dataclasses import fields
from datetime import datetime
from pathlib import Path
from pmc_rd_progress_probe import BomCandidate,BomDetail,RoutingCandidate,RoutingDetail,calculate_results,json_value,candidate_summary


def restore(cls, raw):
    value={field.name:raw.get(field.name) for field in fields(cls) if field.name != 'details'}
    for key in ('created_at','last_modified_at','effective_date','expiry_date'):
        if value.get(key): value[key]=datetime.fromisoformat(value[key])
    return cls(**value)


def oracle(bundle):
    orders=[dict(row) for row in bundle['orders']]
    for row in orders:
        for key in ('order_date','order_created_at','order_last_modified_at'):
            if row.get(key): row[key]=datetime.fromisoformat(row[key])
    boms=[];routes=[]
    for raw in bundle['boms']:
        bom=restore(BomCandidate,raw);bom.details=[restore(BomDetail,d) for d in raw['details']];boms.append(bom)
    for raw in bundle['routings']:
        route=restore(RoutingCandidate,raw);route.details=[restore(RoutingDetail,d) for d in raw['details']];routes.append(route)
    return json_value(calculate_results(orders,bundle['plants'],boms,routes,datetime.fromisoformat(bundle['sourceSnapshotAt'])))


MATCH_FIELDS={'sourceOrderLineId':'orderLineId','sourceOrderId':'orderId','itemId':'itemId','itemCode':'itemCode','rdStatus':'rdStatus','designBomStatus':'designBomStatus','routingStatus':'routingStatus','reasonCode':'reasonCode','reasonText':'reasonText','bomId':'bomId','bomVersion':'bomVersion','bomECode':'bomECode','bomApproveStatus':'bomApproveStatus','validBomDetailCount':'validBomDetailCount','routingId':'itemRoutingId','routingCode':'routingCode','routingApproveStatus':'routingApproveStatus','validOperationCount':'validOperationCount','routingSource':'routingSource','rdLastModifiedAt':'rdLastModifiedAt'}


def compare(bundle, actual):
    expected=oracle(bundle); by_id={r['sourceOrderLineId']:r for r in actual};diff=[]
    for item in expected:
        row=by_id.pop(item['orderLineId'],None)
        if row is None:
            diff.append({'lineId':item['orderLineId'],'missing':True});continue
        for key,source_key in MATCH_FIELDS.items():
            value=row.get(key);reference=item.get(source_key)
            if key=='rdLastModifiedAt':
                value=datetime.fromisoformat(value) if value else None
                reference=datetime.fromisoformat(reference) if reference else None
            if value!=reference:diff.append({'lineId':item['orderLineId'],'orderNo':item['orderNo'],'itemCode':item['itemCode'],'field':key,'python':str(reference),'typescript':str(value)})
    diff.extend({'lineId':identity,'extra':True} for identity in by_id)
    summary=json_value(candidate_summary(expected,2))
    return {'sourceSnapshotAt':bundle['sourceSnapshotAt'],'sourceConsistency':bundle.get('consistency'),'python':summary,'typescript':{'orderCount':len({r['sourceOrderId'] for r in actual}),'itemCount':len(actual),'statusCounts':{status:sum(r['rdStatus']==status for r in actual) for status in summary['statusCounts']}},'differenceCount':len(diff),'differences':diff}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('facts');parser.add_argument('typescript');parser.add_argument('--output',required=True);args=parser.parse_args()
    report=compare(json.loads(Path(args.facts).read_text()),json.loads(Path(args.typescript).read_text()))
    Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({key:report[key] for key in ('sourceSnapshotAt','differenceCount','typescript')},ensure_ascii=False))
    raise SystemExit(1 if report['differenceCount'] else 0)
