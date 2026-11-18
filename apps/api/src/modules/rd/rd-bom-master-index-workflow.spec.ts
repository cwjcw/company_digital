import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

const workflow = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../automation/n8n/rd-bom-master-index-daily.json'), 'utf8')) as {
  active: boolean; settings: { timezone: string }; nodes: Array<{ name: string; type: string; parameters: Record<string, any> }>;
};

function runCodeNode(name: string, input: Record<string, unknown>) {
  const node = workflow.nodes.find(candidate => candidate.name === name);
  if (!node) throw new Error(`Missing n8n node: ${name}`);
  return runInNewContext(`(function(){\n${node.parameters.jsCode}\n})()`, { $input: { first: () => ({ json: input }) } });
}

describe('RD BOM n8n production workflow contract', () => {
  it('keeps Shanghai daily increment and adds hourly stale-sync monitoring', () => {
    expect(workflow.active).toBe(true);
    expect(workflow.settings.timezone).toBe('Asia/Shanghai');
    expect(workflow.nodes.find(node => node.name === '每天01:00上海时间')?.parameters.rule.interval[0].expression).toBe('0 1 * * *');
    expect(workflow.nodes.find(node => node.name === '每小时检查同步成功时效')?.parameters.rule.interval[0].expression).toBe('15 * * * *');
    expect(workflow.nodes.find(node => node.name === '执行BOM增量同步')?.parameters.command).toContain('timeout --signal=TERM --kill-after=30s 600s');
  });

  it('turns nonzero SSH exit and invalid sync summary into an n8n execution failure', () => {
    expect(() => runCodeNode('校验增量同步结果', { code: 1, stderr: 'RD_BOM_SYNC_FAILED:CHANGE_TRACKING_RETENTION_GAP' }))
      .toThrow('RD_BOM_SYNC_FAILED:CHANGE_TRACKING_RETENTION_GAP');
    expect(() => runCodeNode('校验增量同步结果', { code: 0, stdout: 'not-json' })).toThrow('RD_BOM_SYNC_RESULT_MISSING');
    expect(() => runCodeNode('校验增量同步结果', { code: 0, stdout: '{"mode":"INCREMENTAL","status":"FAILED"}' }))
      .toThrow('RD_BOM_SYNC_RESULT_NOT_SUCCESS');
    const result = runCodeNode('校验增量同步结果', { code: 0, stdout: '◇ env loaded\n{"mode":"INCREMENTAL","status":"SUCCESS"}' });
    expect(result[0].json).toMatchObject({ mode: 'INCREMENTAL', status: 'SUCCESS' });
  });

  it('fails the health-monitor execution if a stale alert could not enter the existing notification outbox', () => {
    expect(() => runCodeNode('校验时效预警结果', { code: 0, stdout: '{"status":"SUCCESS","alertLevel":"WARNING","alertEnqueueOk":false}' }))
      .toThrow('RD_BOM_HEALTH_ALERT_NOT_QUEUED');
    expect(runCodeNode('校验时效预警结果', { code: 0, stdout: '{"status":"SUCCESS","alertLevel":null,"alertEnqueueOk":true}' })[0].json.alertLevel).toBeNull();
  });
});
