import { graphic, type EChartsOption } from 'echarts';
import type {PlmDashboard} from '@kdos/contracts';
// Chart options ported from the supplied ZIP; lifecycle belongs to shared KdosChart.
export function oneScreenOptions(D:PlmDashboard):Record<string,EChartsOption> {
const result:Record<string,EChartsOption>={};
  const C = {
    ink: '#e8eeff', muted: '#7e8db0', line: 'rgba(88,130,255,0.16)',
    cyan: '#2fd4e6', green: '#3ddc97', amber: '#ffb454', red: '#ff5d5d', blue: '#4f7cff'
  };
  const BASE = {
    animation: true,
    animationDuration: 700,
    tooltip: { appendToBody: true, backgroundColor: '#111a30', borderColor: C.line, textStyle: { color: C.ink, fontSize: 12 } },
    textStyle: { fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif' }
  };

  function make(id:string, opt:object) { const o=opt as EChartsOption; result[id]={...BASE,...o,...(Array.isArray(o.series)&&o.series.some(s=>s.type==='pie')?{xAxis:{show:false},yAxis:{show:false}}:{}),tooltip:{...(BASE.tooltip),...(o.tooltip as object),renderMode:'richText',confine:true}} as EChartsOption; }

  function axisColors() {
    return {
      axisLabel: { color: C.muted, fontSize: 10 },
      axisLine: { lineStyle: { color: C.line } },
      splitLine: { lineStyle: { color: C.line } }
    };
  }

  /* 1. 项目阶段分布 */
  (function () {
    const rows = D.summary.datas || [];
    const colors = [C.blue, C.cyan, C.green];
    make('c-status', {
      tooltip: { trigger: 'item', appendToBody: true },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: C.muted, fontSize: 10 } },
      series: [{
        type: 'pie', radius: ['48%', '72%'], center: ['50%', '44%'],
        label: { position: 'inside', color: '#0a0f1e', fontSize: 12, fontWeight: 600, formatter: '{c}' },
        labelLine: { show: false },
        data: rows.map(function (r, i) {
          return { name: r.name, value: r.y, itemStyle: { color: colors[i] || C.blue } };
        })
      }]
    });
  })();

  /* 2. 项目经理负载 */
  (function () {
    const rows = D.managers;
    make('c-manager', {
      grid: { left: 74, right: 44, top: 14, bottom: 24 },
      xAxis: Object.assign({ type: 'value' }, axisColors()),
      yAxis: Object.assign({ type: 'category', data: rows.map(function (r) { return r.name; }) }, axisColors(), { splitLine: { show: false } }),
      series: [{
        type: 'bar', barWidth: 12,
        data: rows.map(function (r) { return r.count; }),
        itemStyle: { color: C.blue, borderRadius: [0, 6, 6, 0] },
        label: { show: true, position: 'right', color: C.ink, fontSize: 10 }
      }]
    });
  })();

  /* 3. 进度分布 */
  (function () {
    const buckets = [0, 0, 0, 0, 0];
    D.projects.forEach(function (p) { const bucket=Math.min(Math.floor(p.progress / 20),4); buckets[bucket]=(buckets[bucket]??0)+1; });
    make('c-hist', {
      grid: { left: 40, right: 20, top: 26, bottom: 26 },
      xAxis: Object.assign({ type: 'category', data: ['0-20', '21-40', '41-60', '61-80', '81-100'] }, axisColors()),
      yAxis: Object.assign({ type: 'value' }, axisColors()),
      series: [{
        type: 'bar', barWidth: 20,
        data: buckets.map(function (v, i) {
          return { value: v, itemStyle: { color: i === 0 ? C.amber : C.cyan, borderRadius: [5, 5, 0, 0] } };
        }),
        label: { show: true, position: 'top', color: C.ink, fontSize: 10 }
      }]
    });
  })();

  /* 4. 按月启动趋势 */
  (function () {
    const rows = D.startMonths;
    make('c-month', {
      grid: { left: 40, right: 24, top: 30, bottom: 26 },
      xAxis: Object.assign({ type: 'category', boundaryGap: true, data: rows.map(function (r) { return r.month.slice(2); }) }, axisColors()),
      yAxis: Object.assign({ type: 'value' }, axisColors()),
      series: [{
        type: 'line', symbolSize: 7,
        data: rows.map(function (r) { return r.count; }),
        lineStyle: { color: C.green, width: 2.5 },
        itemStyle: { color: C.green },
        areaStyle: { color: 'rgba(61,220,151,0.14)' },
        label: { show: true, position: 'top', color: C.ink, fontSize: 10 }
      }]
    });
  })();

  /* 5. 进度排行 TOP 8 */
  (function () {
    const rows = D.projects.slice().sort(function (a, b) { return b.progress - a.progress; }).slice(0, 8);
    make('c-rank', {
      grid: { left: 128, right: 52, top: 10, bottom: 22 },
      xAxis: Object.assign({ type: 'value', max: 100, axisLabel: { color: C.muted, fontSize: 10, formatter: '{value}%' }, splitLine: { lineStyle: { color: C.line } }, axisLine: { show: false } }),
      yAxis: Object.assign({ type: 'category', data: rows.map(function (r) { return r.name; }).reverse() }, axisColors(), { splitLine: { show: false }, axisLabel: { color: C.ink, fontSize: 10 } }),
      series: [{
        type: 'bar', barWidth: 10,
        data: rows.map(function (r) { return r.progress; }).reverse(),
        itemStyle: {
          borderRadius: [0, 5, 5, 0],
          color: new graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: C.blue }, { offset: 1, color: C.cyan }])
        },
        label: { show: true, position: 'right', color: C.ink, fontSize: 10, formatter: '{c}%' }
      }]
    });
  })();

  /* 6. 里程碑健康度 TOP 8 */
  (function () {
    const rows = D.projects.slice().sort(function (a, b) { return b.msCount - a.msCount; }).slice(0, 8);
    make('c-ms', {
      tooltip: { trigger: 'axis', appendToBody: true },
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: C.muted, fontSize: 10 } },
      grid: { left: 118, right: 24, top: 26, bottom: 22 },
      xAxis: Object.assign({ type: 'value' }, axisColors()),
      yAxis: Object.assign({ type: 'category', data: rows.map(function (r) { return r.name; }).reverse() }, axisColors(), { splitLine: { show: false }, axisLabel: { color: C.ink, fontSize: 10 } }),
      series: [
        { name: '红', type: 'bar', stack: 'm', barWidth: 10, data: rows.map(function (r) { return r.msRed; }).reverse(), itemStyle: { color: C.red } },
        { name: '绿', type: 'bar', stack: 'm', barWidth: 10, data: rows.map(function (r) { return r.msGreen; }).reverse(), itemStyle: { color: C.green, borderRadius: [0, 5, 5, 0] } }
      ]
    });
  })();

  /* 7. 任务负责人 TOP 8 */
  (function () {
    const rows = D.taskManagers.slice(0, 8);
    make('c-task', {
      grid: { left: 74, right: 44, top: 14, bottom: 24 },
      xAxis: Object.assign({ type: 'value' }, axisColors()),
      yAxis: Object.assign({ type: 'category', data: rows.map(function (r) { return r.name; }).reverse() }, axisColors(), { splitLine: { show: false }, axisLabel: { color: C.ink, fontSize: 10 } }),
      series: [{
        type: 'bar', barWidth: 10,
        data: rows.map(function (r) { return r.count; }).reverse(),
        itemStyle: { color: C.amber, borderRadius: [0, 5, 5, 0] },
        label: { show: true, position: 'right', color: C.ink, fontSize: 10 }
      }]
    });
  })();

  /* 8. 里程碑红绿汇总 */
  (function () {
    let red = 0, green = 0;
    D.projects.forEach(function (p) { red += p.msRed; green += p.msGreen; });
    make('c-msd', {
      tooltip: { trigger: 'item', appendToBody: true },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: C.muted, fontSize: 10 } },
      series: [{
        type: 'pie', radius: ['48%', '72%'], center: ['50%', '44%'],
        label: { color: C.ink, fontSize: 11, formatter: '{b} {c}' },
        data: [
          { name: '红色预警', value: red, itemStyle: { color: C.red } },
          { name: '绿色正常', value: green, itemStyle: { color: C.green } }
        ]
      }]
    });
  })();

return result;
}
export function fullOptions(D:PlmDashboard):Record<string,EChartsOption> {
const result:Record<string,EChartsOption>={};
const accent='#2f6fed',accent2='#12b886',accent3='#f0a13a',warn='#e8590c',ink='#17213a',muted='#5f6b85',rule='rgba(47,111,237,0.12)';
  const BASE = {
    animation: false,
    tooltip: { appendToBody: true, textStyle: { color: ink } },
    textStyle: { fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif' }
  };

  function make(id:string, opt:object) { const o=opt as EChartsOption; result[id]={...BASE,...o,...(Array.isArray(o.series)&&o.series.some(s=>s.type==='pie')?{xAxis:{show:false},yAxis:{show:false}}:{}),tooltip:{...(BASE.tooltip),...(o.tooltip as object),renderMode:'richText',confine:true}} as EChartsOption; }

  /* === 项目阶段分布（环形图） === */
  (function () {
    const rows = (D.summary.datas || []);
    make('chart-status', {
      tooltip: { trigger: 'item', appendToBody: true },
      legend: { bottom: 0, textStyle: { color: muted } },
      series: [{
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        label: { color: ink, formatter: '{b}: {c}' },
        data: rows.map(function (r, i) {
          return { name: r.name, value: r.y, itemStyle: { color: [accent, accent2, accent3][i] || accent } };
        })
      }]
    });
  })();

  /* === 项目经理负责项目数 === */
  (function () {
    const rows = D.managers;
    make('chart-manager', {
      tooltip: { trigger: 'axis', appendToBody: true },
      grid: { left: 90, right: 40, top: 30, bottom: 30 },
      xAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { lineStyle: { color: rule } } },
      yAxis: {
        type: 'category',
        data: rows.map(function (r) { return r.name; }),
        axisLabel: { color: ink },
        axisLine: { lineStyle: { color: rule } }
      },
      series: [{
        type: 'bar',
        data: rows.map(function (r) { return r.count; }),
        barWidth: 18,
        itemStyle: { color: accent, borderRadius: [0, 6, 6, 0] },
        label: { show: true, position: 'right', color: ink }
      }]
    });
  })();

  /* === 项目进度分布直方图 === */
  (function () {
    const buckets = [0, 0, 0, 0, 0];
    D.projects.forEach(function (p) {
      const bucket=Math.min(Math.floor(p.progress / 20),4); buckets[bucket]=(buckets[bucket]??0)+1;
    });
    const labels = ['0-20%', '21-40%', '41-60%', '61-80%', '81-100%'];
    make('chart-progress-hist', {
      tooltip: { trigger: 'axis', appendToBody: true },
      grid: { left: 50, right: 30, top: 30, bottom: 40 },
      xAxis: {
        type: 'category', data: labels,
        axisLabel: { color: muted }, axisLine: { lineStyle: { color: rule } }
      },
      yAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { lineStyle: { color: rule } } },
      series: [{
        type: 'bar',
        data: buckets.map(function (v, i) {
          return { value: v, itemStyle: { color: i === 0 ? accent3 : accent, borderRadius: [6, 6, 0, 0] } };
        }),
        barWidth: 34,
        label: { show: true, position: 'top', color: ink }
      }]
    });
  })();

  /* === 项目按月启动趋势 === */
  (function () {
    const rows = D.startMonths;
    make('chart-month', {
      tooltip: { trigger: 'axis', appendToBody: true },
      grid: { left: 50, right: 30, top: 30, bottom: 40 },
      xAxis: {
        type: 'category', data: rows.map(function (r) { return r.month; }),
        axisLabel: { color: muted }, axisLine: { lineStyle: { color: rule } },
        boundaryGap: true
      },
      yAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { lineStyle: { color: rule } } },
      series: [{
        type: 'line',
        data: rows.map(function (r) { return r.count; }),
        lineStyle: { color: accent, width: 3 },
        itemStyle: { color: accent },
        symbolSize: 9,
        areaStyle: { color: accent + '22' },
        label: { show: true, position: 'top', color: ink }
      }]
    });
  })();

  /* === 项目进度排行 Top 15 === */
  (function () {
    const rows = D.projects.slice().sort(function (a, b) { return b.progress - a.progress; }).slice(0, 15);
    make('chart-rank', {
      tooltip: {
        trigger: 'axis', appendToBody: true,
        formatter: function (ps:Array<{name:string;value:unknown}>) {
          const p = ps[0]!;
          return p.name + '\n进度：' + p.value + '%';
        }
      },
      grid: { left: 200, right: 60, top: 20, bottom: 30 },
      xAxis: { type: 'value', max: 100, axisLabel: { color: muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: rule } } },
      yAxis: {
        type: 'category',
        data: rows.map(function (r) { return r.name + '（' + r.no + '）'; }).reverse(),
        axisLabel: { color: ink, fontSize: 12 },
        axisLine: { lineStyle: { color: rule } }
      },
      series: [{
        type: 'bar',
        data: rows.map(function (r) { return r.progress; }).reverse(),
        barWidth: 14,
        itemStyle: { color: accent2, borderRadius: [0, 6, 6, 0] },
        label: { show: true, position: 'right', color: ink, formatter: '{c}%' }
      }]
    });
  })();

  /* === 里程碑健康度（堆叠条形，Top 12） === */
  (function () {
    const rows = D.projects.slice().sort(function (a, b) { return b.msCount - a.msCount; }).slice(0, 12);
    make('chart-milestone', {
      tooltip: { trigger: 'axis', appendToBody: true },
      legend: { top: 0, textStyle: { color: muted } },
      grid: { left: 210, right: 40, top: 40, bottom: 30 },
      xAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { lineStyle: { color: rule } } },
      yAxis: {
        type: 'category',
        data: rows.map(function (r) { return r.name + '（' + r.manager + '）'; }).reverse(),
        axisLabel: { color: ink, fontSize: 12 },
        axisLine: { lineStyle: { color: rule } }
      },
      series: [
        {
          name: '红色预警',
          type: 'bar',
          stack: 'ms',
          barWidth: 16,
          data: rows.map(function (r) { return r.msRed; }).reverse(),
          itemStyle: { color: warn }
        },
        {
          name: '绿色正常',
          type: 'bar',
          stack: 'ms',
          barWidth: 16,
          data: rows.map(function (r) { return r.msGreen; }).reverse(),
          itemStyle: { color: accent2, borderRadius: [0, 6, 6, 0] }
        }
      ]
    });
  })();

  /* === 任务负责人 Top 10 === */
  (function () {
    const rows = D.taskManagers;
    make('chart-taskmgr', {
      tooltip: { trigger: 'axis', appendToBody: true },
      grid: { left: 80, right: 50, top: 20, bottom: 30 },
      xAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { lineStyle: { color: rule } } },
      yAxis: {
        type: 'category',
        data: rows.map(function (r) { return r.name; }).reverse(),
        axisLabel: { color: ink },
        axisLine: { lineStyle: { color: rule } }
      },
      series: [{
        type: 'bar',
        data: rows.map(function (r) { return r.count; }).reverse(),
        barWidth: 14,
        itemStyle: { color: accent, borderRadius: [0, 6, 6, 0] },
        label: { show: true, position: 'right', color: ink }
      }]
    });
  })();

  /* === 里程碑健康度汇总（环形图） === */
  (function () {
    let red = 0, green = 0;
    D.projects.forEach(function (p) { red += p.msRed; green += p.msGreen; });
    make('chart-ms-donut', {
      tooltip: { trigger: 'item', appendToBody: true },
      legend: { bottom: 0, textStyle: { color: muted } },
      series: [{
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        label: { color: ink, formatter: '{b}: {c}（{d}%）' },
        data: [
          { name: '红色预警', value: red, itemStyle: { color: warn } },
          { name: '绿色正常', value: green, itemStyle: { color: accent2 } }
        ]
      }]
    });
  })();


return result;
}
