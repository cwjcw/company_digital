import contextlib
import fcntl
import stat
import subprocess
import types
import copy
import io
import json
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from PIL import Image

import report


def fixture(end=date(2026, 10, 29), complete=False):
    start = end - timedelta(days=6)
    days, trend, by_unit = [], [], {n: [] for n in report.DIVISIONS}
    yesterday_rows = []
    for i in range(7):
        day = (start + timedelta(days=i)).isoformat()
        filled = 20 if complete else 16
        division_rows = []
        for n in report.DIVISIONS:
            r = {'date': day, 'expectedEquipmentCount': 20, 'filledEquipmentCount': filled,
                 'unfilledEquipmentCount': 20-filled, 'reportingRate': filled/20*100,
                 'plannedRuntimeMinutes': 9600, 'runtimeMinutes': 8000, 'utilizationRate': 82.5}
            by_unit[n].append(r)
            division_rows.append({'division': '凯南'+n if n.startswith('事业') else n,
                                  'equipmentCount': 20, 'normalCount': filled-3, 'faultCount': 2,
                                  'idleCount': 1, 'unreportedCount': 20-filled,
                                  'plannedRuntimeMinutes': 9600, 'runtimeMinutes': 8000,
                                  'utilizationRate': 82.5, 'faultMinutes': 60})
        metrics = {'firstBatchMonitoringEquipment': 100, 'dailyRecordedEquipment': filled*5,
                   'normalEquipment': (filled-3)*5, 'faultEquipment': 10, 'idleEquipment': 5,
                   'plannedRuntimeMinutes': 48000, 'runtimeMinutes': 40000, 'faultMinutes': 300,
                   'utilizationRate': 82.5}
        days.append({'date': day, 'metrics': metrics, 'divisionRows': division_rows})
        trend.append({'date': day, 'expectedEquipmentCount': 100, 'filledEquipmentCount': filled*5,
                      'unfilledEquipmentCount': 100-filled*5, 'reportingRate': filled/20*100})
        if i == 6:
            yesterday_rows = [{'division': n, **by_unit[n][-1]} for n in report.DIVISIONS]
    return {'schemaVersion': 1, 'reportDate': end.isoformat(), 'startDate': start.isoformat(), 'endDate': end.isoformat(),
            'divisions': list(report.DIVISIONS), 'days': days,
            'reporting': {'yesterday': trend[-1], 'yesterdayDivisionRows': yesterday_rows,
                          'sevenDayTrend': {'total': trend, 'divisions': [{'divisionName': n, 'rows': rows} for n, rows in by_unit.items()]}}}


class FakePusher:
    def __init__(self, fail=None, error=None):
        self.calls = []
        self.fail, self.error = fail, error

    def get_contacts(self, include_detail=True):
        return [{'name': '崔玮杰', 'userid': 'test-cui'}, {'name': '其他人', 'userid': 'other'}]

    def send(self, component, content, touser):
        self.calls.append((component, content, touser))
        if self.error == component:
            raise TimeoutError('network result unknown')
        return {'errcode': 40001 if self.fail == component else 0, 'errmsg': 'test response'}

    def send_app_text(self, text, touser='@all'):
        return self.send('text', text, touser)

    def send_app_image(self, path, touser='@all'):
        return self.send(Path(path).stem+'_image', path, touser)


def send(pusher, complete=False, **kwargs):
    return report.send_report(Path('operation.png'), lambda: Path('reporting.png'), '固定文字',
                              lambda: not complete, ['崔玮杰'], pusher, sleeper=lambda x: None, **kwargs)


class DatesTest(unittest.TestCase):
    def test_yesterday_and_inclusive_seven_days(self):
        self.assertEqual(report.reporting_window(datetime(2026, 10, 30, 12, tzinfo=report.SHANGHAI)), (date(2026, 10, 23), date(2026, 10, 29)))

    def test_month_boundary(self):
        self.assertEqual(report.reporting_window(datetime(2026, 3, 1, 12, tzinfo=report.SHANGHAI)), (date(2026, 2, 22), date(2026, 2, 28)))

    def test_leap_month(self):
        self.assertEqual(report.reporting_window(datetime(2024, 3, 1, 12, tzinfo=report.SHANGHAI))[1], date(2024, 2, 29))

    def test_year_boundary(self):
        self.assertEqual(report.reporting_window(datetime(2027, 1, 1, tzinfo=report.SHANGHAI)), (date(2026, 12, 25), date(2026, 12, 31)))

    def test_utc_input_uses_shanghai_day(self):
        self.assertEqual(report.reporting_window(datetime(2026, 10, 30, 21, tzinfo=timezone.utc))[1], date(2026, 10, 30))
        with self.assertRaises(ValueError):
            report.reporting_window(datetime(2026, 10, 30))

    def test_exact_notification_text(self):
        self.assertEqual(report.notification_text(date(2026, 10, 29)), '【设备管理日报表】2026年10月29日\n\n日报1：设备运行日报。\n\n日报2：设备填报情况。过去7天集团填报率为100%时，不发送设备填报报表；未达到100%时，发送设备填报报表。')


class BusinessTest(unittest.TestCase):
    def test_five_units_same_level(self):
        self.assertEqual([r['name'] for r in report.unit_rows(fixture())], ['事业一部', '事业二部', '事业三部', '事业四部', '研发中心'])

    def test_complete_700_of_700(self):
        self.assertEqual(report.seven_day_counts(fixture(complete=True)), (700, 700))
        self.assertTrue(report.seven_day_complete(fixture(complete=True)))

    def test_incomplete_699_of_700(self):
        data = fixture(complete=True)
        data['reporting']['sevenDayTrend']['total'][0]['filledEquipmentCount'] -= 1
        self.assertEqual(report.seven_day_counts(data), (699, 700))
        self.assertFalse(report.seven_day_complete(data))

    def test_rounded_100_is_not_complete(self):
        data = fixture(complete=True)
        for r in data['reporting']['sevenDayTrend']['total']:
            r.update(expectedEquipmentCount=1000, filledEquipmentCount=1000, reportingRate=100.0)
        data['reporting']['sevenDayTrend']['total'][0]['filledEquipmentCount'] = 999
        filled, expected = report.seven_day_counts(data)
        self.assertEqual(report.percentage(filled, expected), '100.0%')
        self.assertFalse(report.seven_day_complete(data))

    def test_zero_expected_and_invalid_counts(self):
        data = fixture()
        for r in data['reporting']['sevenDayTrend']['total']:
            r.update(expectedEquipmentCount=0, filledEquipmentCount=0)
        self.assertTrue(report.seven_day_complete(data))  # exact equality as requested; display —
        for value in (-1, 1.5, '100.0%', True):
            with self.assertRaises(ValueError):
                report.count(value)
        data['reporting']['sevenDayTrend']['total'][0].update(expectedEquipmentCount=1, filledEquipmentCount=2)
        with self.assertRaises(ValueError):
            report.seven_day_complete(data)

    def test_validate_dates_scope_and_missing_days(self):
        data = fixture()
        report.validate_summary(data, date(2026, 10, 23), date(2026, 10, 29))
        for change in ('missing_day', 'wrong_date', 'old_schema', 'missing_rd'):
            invalid = copy.deepcopy(data)
            if change == 'missing_day': invalid['days'].pop()
            if change == 'wrong_date': invalid['reportDate'] = '2026-10-28'
            if change == 'old_schema': invalid['schemaVersion'] = 0
            if change == 'missing_rd': invalid['divisions'].pop()
            with self.subTest(change=change), self.assertRaises(ValueError):
                report.validate_summary(invalid, date(2026, 10, 23), date(2026, 10, 29))

    def test_missing_zero_equipment_units_still_display_and_no_rank(self):
        data = fixture()
        data['days'][-1]['divisionRows'] = []
        data['reporting']['yesterdayDivisionRows'] = []
        data['reporting']['sevenDayTrend']['divisions'] = []
        self.assertEqual(len(report.unit_rows(data)), 5)
        self.assertEqual(report.reporting_rankings(data), ('无应填设备，暂无排名',)*2)

    def test_reporting_ties_and_operation_does_not_rank(self):
        best, worst = report.reporting_rankings(fixture())
        for n in report.DIVISIONS:
            self.assertIn(n, best); self.assertIn(n, worst)
        import inspect
        self.assertNotIn('rankings(', inspect.getsource(report.render_operation_report))


class SendingTest(unittest.TestCase):
    def test_uncompleted_sequence_and_receiver(self):
        p = FakePusher(); result = send(p)
        self.assertEqual([x[0] for x in p.calls], ['text', 'operation_image', 'reporting_image'])
        self.assertEqual({x[2] for x in p.calls}, {'test-cui'})
        self.assertEqual(result['recipientCount'], 1)
        self.assertTrue(p.calls[0][1].startswith('您好,崔玮杰,请收\n\n'))
        self.assertTrue(result['reportingImageSent'])

    def test_completed_never_renders_or_sends_reporting(self):
        p = FakePusher()
        result = report.send_report(Path('operation.png'), lambda: self.fail('reporting generated'), '正文', lambda: False, ['崔玮杰'], p, sleeper=lambda x: None)
        self.assertEqual([x[0] for x in p.calls], ['text', 'operation_image'])
        self.assertFalse(result['reportingImageSent'])

    def test_decision_runs_after_operation_success_and_delays(self):
        p = FakePusher(); waits = []
        def decision():
            self.assertEqual([x[0] for x in p.calls], ['text', 'operation_image'])
            return True
        report.send_report(Path('operation.png'), lambda: Path('reporting.png'), '正文', decision, ['崔玮杰'], p, sleeper=waits.append)
        self.assertEqual(waits, [3, 5])

    def test_stop_at_each_send_failure(self):
        for component, expected in [('text', ['text']), ('operation_image', ['text', 'operation_image']), ('reporting_image', ['text', 'operation_image', 'reporting_image'])]:
            p = FakePusher(fail=component)
            with self.subTest(component=component), self.assertRaises(RuntimeError): send(p)
            self.assertEqual([x[0] for x in p.calls], expected)

    def test_replay_and_partial_failure_do_not_repeat_successes(self):
        p = FakePusher(fail='operation_image'); receipt = {}
        with self.assertRaises(RuntimeError): send(p, receipt=receipt)
        p.fail = None
        send(p, receipt=receipt); send(p, receipt=receipt)
        self.assertEqual([x[0] for x in p.calls], ['text', 'operation_image', 'operation_image', 'reporting_image'])

    def test_multiple_recipients_each_receive_own_greeting_and_progress(self):
        p = FakePusher()
        p.get_contacts = lambda **kwargs: [{'name': '刘义响', 'userid': 'user-liu'}, {'name': '朱永远', 'userid': 'user-zhu'}]
        receipt = {}; renders = []
        def reporting():
            renders.append(True); return Path('reporting.png')
        for _ in range(2):
            report.send_report(Path('operation.png'), reporting, '正文', lambda: True, ['刘义响', '朱永远'], p, receipt=receipt, sleeper=lambda _: None)
        self.assertEqual([x[0] for x in p.calls], ['text', 'operation_image', 'reporting_image']*2)
        self.assertEqual([x[2] for x in p.calls], ['user-liu']*3+['user-zhu']*3)
        self.assertEqual(p.calls[0][1], '您好,刘义响,请收\n\n正文')
        self.assertEqual(p.calls[3][1], '您好,朱永远,请收\n\n正文')
        self.assertEqual(renders, [True])
        self.assertEqual(receipt['deliveries']['user-zhu']['text'], 'sent')

    def test_unknown_provider_result_fails_closed(self):
        p = FakePusher(error='operation_image'); receipt = {}
        with self.assertRaises(TimeoutError): send(p, receipt=receipt)
        with self.assertRaisesRegex(RuntimeError, '禁止自动重发'): send(p, receipt=receipt)
        self.assertEqual(len(p.calls), 2)

    def test_test_recipient_and_delay_configuration(self):
        c = report.read_config()
        self.assertEqual(c['test_recipients'], ['崔玮杰'])
        self.assertTrue(c['allow_production_send'])
        self.assertNotIn('高婷武', c['production_recipients'])
        self.assertNotIn('崔玮杰', c['production_recipients'])
        self.assertEqual(len(c['production_recipients']), 9)
        self.assertEqual(c['schedule'], {'time': '12:00', 'timezone': 'Asia/Shanghai', 'mode': '--send-production --confirm-production'})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'config.json'
            for field, value in [('test_recipients', c['production_recipients']), ('text_delay_seconds', float('nan')), ('divisions', list(report.DIVISIONS[:-1]))]:
                bad = {**c, field: value}; path.write_text(json.dumps(bad))
                with self.subTest(field=field), self.assertRaises(ValueError): report.read_config(path)

    def test_reject_missing_ambiguous_and_all_contacts(self):
        with self.assertRaisesRegex(RuntimeError, '通讯录未找到'): report.resolve_user_ids(FakePusher(), ['不存在'])
        with self.assertRaises(ValueError): report.resolve_user_ids(FakePusher(), ['@all'])
        p = FakePusher(); p.get_contacts = lambda **kwargs: [{'name': '崔玮杰', 'userid': 'a'}, {'name': '崔玮杰', 'userid': 'b'}]
        with self.assertRaisesRegex(RuntimeError, '通讯录重名'): report.resolve_user_ids(p, ['崔玮杰'])

    def test_production_and_fixture_sending_fail_before_query(self):
        disabled = {**report.read_config(), 'allow_production_send': False}
        with patch.object(report, 'load_live_summary') as live, patch.object(report, 'read_config', return_value=disabled):
            for args in (['--send-production'], ['--send-production', '--confirm-production'], ['--send-test', '--data-json', 'fixture.json'], ['--check-production'], ['--notify-failure']):
                with self.subTest(args=args), self.assertRaises(ValueError): report.main(args)
            live.assert_not_called()
        with patch.object(report, 'load_live_summary') as live:
            with self.assertRaises(ValueError): report.main(['--send-production'])
            live.assert_not_called()


class MainWorkflowTest(unittest.TestCase):
    def run_main(self, folder, pusher, complete=False, run_id=None):
        config = {**report.read_config(), 'text_delay_seconds': 0, 'reporting_image_delay_seconds': 0}
        module = types.SimpleNamespace(WeChatPusher=lambda: pusher)
        with patch.object(report, 'read_config', return_value=config), patch.object(report, 'load_live_summary', return_value=fixture(complete=complete)), patch.object(report, 'reporting_window', return_value=(date(2026, 10, 23), date(2026, 10, 29))), patch.dict('sys.modules', {'wechat': module}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(report.main(['--send-test', '--output-dir', folder] + (['--test-run-id', run_id] if run_id else [])), 0)

    def test_real_entrypoint_test_mode_persists_receipts_and_replay(self):
        with tempfile.TemporaryDirectory() as folder:
            pusher = FakePusher()
            self.run_main(folder, pusher); self.run_main(folder, pusher)
            self.assertEqual([x[0] for x in pusher.calls], ['text', 'operation_image', 'reporting_image'])
            self.assertEqual({x[2] for x in pusher.calls}, {'test-cui'})
            path = Path(folder)/'2026-10-29/test-receipt.json'
            receipt = json.loads(path.read_text())
            self.assertEqual(receipt['reporting_image'], 'sent')
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertFalse((path.parent/'production-receipt.json').exists())

    def test_explicit_test_revision_preserves_previous_success_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            p = FakePusher(); self.run_main(folder, p)
            previous = Path(folder)/'2026-10-29/test-receipt.json'
            frozen = previous.read_bytes()
            self.run_main(folder, p, run_id='greeting-hd-v1')
            self.run_main(folder, p, run_id='greeting-hd-v1')
            self.assertEqual(len(p.calls), 6)
            self.assertEqual(previous.read_bytes(), frozen)
            self.assertTrue((previous.parent/'tests/greeting-hd-v1/test-receipt.json').exists())

    def test_test_run_id_cannot_escape_or_enable_other_modes(self):
        with patch.object(report, 'load_live_summary') as live:
            for args in (['--test-run-id', 'sample'], ['--send-test', '--test-run-id', '../escape'], ['--send-production', '--confirm-production', '--test-run-id', 'formal']):
                with self.subTest(args=args), self.assertRaises(ValueError): report.main(args)
            live.assert_not_called()

    def test_complete_main_does_not_generate_reporting_image(self):
        with tempfile.TemporaryDirectory() as folder:
            pusher = FakePusher(); self.run_main(folder, pusher, complete=True)
            self.assertEqual([x[0] for x in pusher.calls], ['text', 'operation_image'])
            self.assertFalse((Path(folder)/'2026-10-29/reporting.png').exists())

    def test_enabled_confirmed_production_routes_only_the_nine_report_recipients(self):
        config = {**report.read_config(), 'text_delay_seconds': 0, 'reporting_image_delay_seconds': 0}
        p = FakePusher(); names = config['production_recipients']
        p.get_contacts = lambda **kwargs: [{'name': name, 'userid': 'formal-'+str(i)} for i, name in enumerate(names)]
        module = types.SimpleNamespace(WeChatPusher=lambda: p)
        with tempfile.TemporaryDirectory() as folder, patch.object(report, 'read_config', return_value=config), patch.object(report, 'load_live_summary', return_value=fixture()), patch.object(report, 'reporting_window', return_value=(date(2026, 10, 23), date(2026, 10, 29))), patch.dict('sys.modules', {'wechat': module}), contextlib.redirect_stdout(io.StringIO()):
            report.main(['--send-production', '--confirm-production', '--output-dir', folder])
            report.main(['--send-production', '--confirm-production', '--output-dir', folder])
            self.assertEqual(len(p.calls), 27)
            self.assertTrue((Path(folder)/'2026-10-29/production/production-receipt.json').exists())
            self.assertFalse((Path(folder)/'2026-10-29/test-receipt.json').exists())
            for i, name in enumerate(names):
                self.assertEqual(p.calls[i*3][1].splitlines()[0], f'您好,{name},请收')
                self.assertEqual([x[2] for x in p.calls[i*3:i*3+3]], ['formal-'+str(i)]*3)

    def test_formal_preflight_checks_contacts_without_sending(self):
        config = report.read_config(); p = FakePusher()
        p.get_contacts = lambda **kwargs: [{'name': name, 'userid': 'formal-'+str(i)} for i, name in enumerate(config['production_recipients'])]
        with tempfile.TemporaryDirectory() as folder, patch.object(report, 'create_pusher', return_value=p), patch.object(report, 'load_live_summary', return_value=fixture()), patch.object(report, 'reporting_window', return_value=(date(2026, 10, 23), date(2026, 10, 29))), contextlib.redirect_stdout(io.StringIO()) as stream:
            report.main(['--check-production', '--output-dir', folder])
            data = json.loads(stream.getvalue()); self.assertTrue(data['ready']); self.assertFalse(data['sent']); self.assertEqual(data['recipientCount'], 9); self.assertEqual(p.calls, [])

    def test_operational_failure_alert_is_separate_and_never_queries_business(self):
        p = FakePusher()
        with patch.object(report, 'create_pusher', return_value=p), patch.object(report, 'load_live_summary') as live, contextlib.redirect_stdout(io.StringIO()):
            report.main(['--notify-failure']); live.assert_not_called()
        self.assertEqual(len(p.calls), 1); self.assertEqual(p.calls[0][2], 'test-cui')
        self.assertIn('设备管理日报发送失败', p.calls[0][1])
        with self.assertRaises(RuntimeError): report.send_failure_alert(['崔玮杰'], FakePusher(fail='text'))

    def test_concurrent_entrypoint_fails_before_query(self):
        with tempfile.TemporaryDirectory() as folder, (Path(folder)/'.report.lock').open('a') as lock, patch.object(report, 'load_live_summary') as live:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, '拒绝并发'):
                report.main(['--output-dir', folder])
            live.assert_not_called()


class WorkflowDefinitionTest(unittest.TestCase):
    def setUp(self):
        self.workflow = json.loads((report.PROJECT_DIR/'workflow-template.json').read_text())

    def test_one_existing_workflow_formal_command_timezone_and_error_branch(self):
        w = self.workflow
        self.assertEqual(w['id'], 'e0dwMjv9OnWmcESk'); self.assertFalse(w['active'])
        self.assertEqual(w['settings']['timezone'], 'Asia/Shanghai')
        nodes = {n['name']: n for n in w['nodes']}
        self.assertEqual(nodes['每天12点']['parameters']['rule']['interval'][0]['expression'], '0 0 12 * * *')
        self.assertIn('--send-production --confirm-production', nodes['发送设备管理日报']['parameters']['command'])
        self.assertNotIn('--test-run-id', nodes['发送设备管理日报']['parameters']['command'])
        self.assertIn('--notify-failure', nodes['发送失败告警']['parameters']['command'])
        self.assertEqual(w['connections']['核验发送结果']['main'][1][0]['node'], '发送失败告警')
        self.assertIn('__EXISTING_SSH_CREDENTIAL_ID__', json.dumps(w))

    def test_validator_rejects_nonzero_missing_json_wrong_mode_count_or_sequence(self):
        code = next(n['parameters']['jsCode'] for n in self.workflow['nodes'] if n['type']=='n8n-nodes-base.code')
        result = {'mode':'production','recipientCount':9,'sent':True,'reportingImageSent':True,'sequence':['text','operation_image','reporting_image']}
        cases = [(True, {'code':0,'stdout':json.dumps(result)})]
        cases += [(False, {'code':1,'stdout':json.dumps(result)}), (False, {'code':0,'stdout':'not json'})]
        for update in ({'mode':'test'}, {'recipientCount':1}, {'sent':False}, {'sequence':['operation_image','text']}):
            cases.append((False, {'code':0,'stdout':json.dumps({**result,**update})}))
        for expected, item in cases:
            worker = "const fs=require('fs');const x=JSON.parse(fs.readFileSync(0,'utf8'));try {new Function('$input',x.code)({first:()=>({json:x.item})});}catch(e){process.exitCode=1}"
            process = subprocess.run(['node','-e',worker], input=json.dumps({'code':code,'item':item}), text=True, capture_output=True, check=False)
            with self.subTest(item=item): self.assertEqual(process.returncode==0, expected)


class RenderTest(unittest.TestCase):
    def test_both_images_nonempty_size_and_no_input_mutation(self):
        data = fixture(); original = copy.deepcopy(data)
        with tempfile.TemporaryDirectory() as folder:
            for render, name in [(report.render_operation_report, 'operation'), (report.render_reporting_report, 'reporting')]:
                path = render(data, Path(folder)/(name+'.png'))
                self.assertGreater(path.stat().st_size, 10000)
                with Image.open(path) as image:
                    self.assertEqual(image.size, (2880, 3040)); self.assertEqual(image.format, 'PNG')
                    self.assertLessEqual(path.stat().st_size, report.MAX_IMAGE_BYTES)
        self.assertEqual(data, original)

    def test_native_resolution_footer_and_upload_size_guard(self):
        self.assertEqual(report.font(22).size, 44)
        self.assertEqual(report.DATA_SOURCE_FOOTER, '数据口径：KDOS设备管理大屏')
        with tempfile.TemporaryDirectory() as folder, patch.object(report, 'MAX_IMAGE_BYTES', 1):
            with self.assertRaisesRegex(ValueError, '超过企业微信2MB限制'):
                report.render_operation_report(fixture(), Path(folder)/'oversize.png')

    def test_main_preview_never_sends(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(report, 'load_live_summary', return_value=fixture()), patch.object(report, 'reporting_window', return_value=(date(2026, 10, 23), date(2026, 10, 29))), patch.object(report, 'send_report') as sender:
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream): self.assertEqual(report.main(['--output-dir', folder]), 0)
            out = json.loads(stream.getvalue()); self.assertFalse(out['sent']); self.assertTrue(Path(out['operationImage']).exists()); self.assertTrue(Path(out['reportingImage']).exists()); sender.assert_not_called()


if __name__ == '__main__':
    unittest.main()
