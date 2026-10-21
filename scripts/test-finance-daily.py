#!/usr/bin/env python3
"""Synthetic shell integration; no Docker, ERP, database or notification calls."""
import json
import pathlib
import shlex
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class FinanceDailyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='kdos-finance-daily-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'data-operations/e10').mkdir(parents=True)
        source = (ROOT / 'data-operations/e10/run-finance-daily.sh').read_text()
        source = source.replace('cd /data/automation/code/work/PMC/knweb', 'cd ' + shlex.quote(str(self.root)))
        source = source.replace('/tmp/kdos-finance-daily.lock', str(self.root / 'daily.lock'))
        self.entry = self.root / 'daily.sh'
        self.entry.write_text(source)
        self.update()
        self.summary()

    def script(self, name, text):
        (self.root / 'data-operations/e10' / name).write_text('#!/bin/bash\nset -e\n' + text)

    def update(self, result=None, before='', exit_code=0):
        payload = json.dumps(result if result is not None else {'status': 'SUCCESS', 'id': 'synthetic-run', 'changedCount': 2})
        self.script('sync-finance-movements.sh', 'echo "update:$1" >> calls\n' + before + '\nprintf "%s\\n" ' + shlex.quote(payload) + '\nexit ' + str(exit_code))

    def summary(self, result=None, exit_code=0):
        payload = json.dumps(result if result is not None else {'status': 'SUCCESS', 'enqueued': 0, 'skipped': 'SYNTHETIC'})
        self.script('push-finance-monthly-summary.sh', 'echo summary >> calls\nprintf "%s\\n" ' + shlex.quote(payload) + '\nexit ' + str(exit_code))

    def run_entry(self, *args):
        return subprocess.run(['bash', str(self.entry), *args], capture_output=True, text=True)

    def calls(self):
        return (self.root / 'calls').read_text().splitlines() if (self.root / 'calls').exists() else []

    def test_update_precedes_summary_and_returns_safe_counts(self):
        result = self.run_entry()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ['update:INCREMENTAL', 'summary'])
        self.assertEqual(json.loads(result.stdout)['updateRunId'], 'synthetic-run')

    def test_nonzero_update_never_dispatches(self):
        self.update(exit_code=42)
        self.assertEqual(self.run_entry().returncode, 42)
        self.assertEqual(self.calls(), ['update:INCREMENTAL'])

    def test_failed_or_malformed_success_output_never_dispatches(self):
        for result in [{'status': 'FAILED'}, [], 'not a result']:
            self.update(result=result)
            self.assertNotEqual(self.run_entry().returncode, 0)
        self.assertNotIn('summary', self.calls())

    def test_summary_failures_are_not_reported_as_success(self):
        for result, code in [({'status': 'FAILED'}, 0), ({'status': 'SUCCESS'}, 23)]:
            self.summary(result, code)
            self.assertNotEqual(self.run_entry().returncode, 0)

    def test_update_only_mode_never_calls_message_dispatch(self):
        result = self.run_entry('--update-only')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.calls(), ['update:INCREMENTAL'])
        self.assertEqual(json.loads(result.stdout)['skipped'], 'UPDATE_ONLY_NO_NOTIFICATION')

    def test_rejects_full_and_unknown_modes(self):
        for mode in ['FULL', '--initialize', '--arbitrary']:
            self.assertEqual(self.run_entry(mode).returncode, 64)
        self.assertEqual(self.calls(), [])

    def test_lock_rejects_concurrent_run(self):
        self.update(before='sleep 0.6')
        first = subprocess.Popen(['bash', str(self.entry)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(100):
                if self.calls():
                    break
                time.sleep(0.01)
            self.assertEqual(self.run_entry().returncode, 75)
            first.communicate(timeout=5)
            self.assertEqual(first.returncode, 0)
            self.assertEqual(self.calls(), ['update:INCREMENTAL', 'summary'])
        finally:
            if first.poll() is None:
                first.terminate()
                first.communicate()

    def test_workflow_keeps_one_daily_trigger_and_uses_builtin_notification_path(self):
        workflow = json.loads((ROOT / 'automation/finance_monthly_summary/workflow.template.json').read_text())
        schedules = [node for node in workflow['nodes'] if node['type'].endswith('scheduleTrigger')]
        self.assertEqual(len(schedules), 1)
        self.assertEqual(schedules[0]['parameters']['rule']['interval'], [{'field': 'cronExpression', 'expression': '30 8 * * *'}])
        self.assertEqual(workflow['settings']['timezone'], 'Asia/Shanghai')
        command = next(node for node in workflow['nodes'] if node['type'].endswith('.ssh'))['parameters']['command']
        self.assertEqual(command, 'bash /data/automation/code/work/PMC/knweb/data-operations/e10/run-finance-daily.sh')
        self.assertFalse(workflow['active'])
        self.assertTrue(all('credentials' not in node for node in workflow['nodes']))
        self.assertFalse(any('wechat' in node['type'].lower() or 'httpRequest' in node['type'] for node in workflow['nodes']))

    def test_n8n_validator_rejects_nonzero_failed_and_invalid_results(self):
        workflow = json.loads((ROOT / 'automation/finance_monthly_summary/workflow.template.json').read_text())
        validator = next(node for node in workflow['nodes'] if node['type'].endswith('.code'))['parameters']['jsCode']
        test_js = """const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const source=fs.readFileSync(0,'utf8');const run=result=>vm.runInNewContext('(function(){'+source+'})()',{$input:{first:()=>({json:result})}});const ok={status:'SUCCESS',updateRunId:'synthetic',changedCount:2,enqueued:0};assert.equal(run({code:0,stdout:JSON.stringify(ok)})[0].json.updateRunId,'synthetic');for(const result of [{code:75,stdout:JSON.stringify(ok)},{code:0,stdout:'invalid'},{code:0,stdout:JSON.stringify({status:'FAILED'})}])assert.throws(()=>run(result));"""
        result = subprocess.run(['node', '-e', test_js], input=validator, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
