import {useEffect,useMemo,useRef,useState} from 'react';
import {Alert,Button,Empty,Segmented,Spin,message} from 'antd';
import {useQuery} from '@tanstack/react-query';
import {plmProgressResource,plmProjectColumns,type PlmDashboard,type PlmProgressResponse,type PlmProject} from '@kdos/contracts';
import {api} from '../../../api';
import {KdosChart} from '../../../shared/charts';
import {hasResourcePermission} from '../../../shared/KdosDataTable';
import {downloadApiFile} from '../../../shared/legacy-ui';
import {oneScreenOptions,fullOptions} from './plm-chart-options';
import './plm-progress.css';
const shortTitles=['项目阶段分布','项目经理负载','项目进度分布','按月启动趋势','进度排行 TOP 8','里程碑健康度 TOP 8','任务负责人 TOP 8','里程碑红绿汇总'];
const fullTitles=['项目阶段分布','项目经理负责项目数','项目进度分布','项目按月启动数量趋势','项目进度排行 Top 15','项目里程碑健康度（红=预警 / 绿=正常，Top 12）','任务负责人 Top 10（按任务数）','里程碑健康度汇总'];
const shortIds=['c-status','c-manager','c-hist','c-month','c-rank','c-ms','c-task','c-msd'];
const fullIds=['chart-status','chart-manager','chart-progress-hist','chart-month','chart-rank','chart-milestone','chart-taskmgr','chart-ms-donut'];
const dependencies=[['overview'],['overview','manager'],['progress'],['overview','start'],['progress','name'],['msCount','msRed','msGreen','name'],['overview','taskCount'],['msRed','msGreen']];
const displayTime=(value:string|null)=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'尚无成功同步';
const noFields:string[]=[];
const stateLabels={NOT_INITIALIZED:'未同步',RUNNING:'同步中',SUCCESS:'成功',FAILED:'失败'};
function normalize(data:NonNullable<PlmProgressResponse['data']>):PlmDashboard {
 const blank:PlmProject={no:'',name:'',manager:null,start:null,end:null,progress:0,health:null,msRed:0,msGreen:0,msCount:0,taskCount:0};
 return {summary:data.summary??{allPjNum:0,datas:[]},kpis:data.kpis??{total:0,detail:0,ms:0,task:0,avgProgress:0,redProjects:0},projects:data.projects.map(p=>({...blank,...p})),managers:data.managers??[],taskManagers:data.taskManagers??[],startMonths:data.startMonths??[]};
}
function Kpis({data,full=false}:{data:PlmDashboard;full?:boolean}){const k=data.kpis;return <div className={full?'kpi-grid':'kpis'} data-testid="plm-kpis">{[[k.total,'系统项目总数'],[k.detail,'看板明细项目'],[k.ms,'里程碑总数'],[k.task,'任务总数'],[`${k.avgProgress}%`,'明细平均进度'],[k.redProjects,'红色预警项目']].map(([value,label],i)=><div key={label} className={`kpi c${[1,2,3,3,5,6][i]}`}>{full?<><div className="num">{value}</div><div className="label">{label}</div></>:<><b>{value}</b><span>{label}</span></>}</div>)}</div>;}
export function PlmProjectProgressPage(){
 const [view,setView]=useState('overview'),[height,setHeight]=useState(600),[exporting,setExporting]=useState(false),viewport=useRef<HTMLDivElement>(null);
 const snapshot=useQuery({queryKey:[plmProgressResource],queryFn:()=>api<PlmProgressResponse>('/rd/project-progress'),refetchInterval:60000,retry:1});
 const response=snapshot.data,data=useMemo(()=>response?.data?normalize(response.data):null,[response]),fields=response?.visibleFields??noFields;
 const options=useMemo(()=>data?(view==='overview'?oneScreenOptions(data):fullOptions(data)):{},[data,view]);
 useEffect(()=>{const resize=()=>{if(viewport.current)setHeight(Math.max(440,window.innerHeight-viewport.current.getBoundingClientRect().top-20));};resize();const o=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(resize);if(viewport.current?.parentElement)o?.observe(viewport.current.parentElement);window.addEventListener('resize',resize);return()=>{o?.disconnect();window.removeEventListener('resize',resize);};},[view,response?.lastResult]);
 const chart=(i:number)=>{const allowed=dependencies[i]!.every(k=>fields.includes(k))&&(view==='overview'||i!==4||fields.includes('no'))&&(view==='overview'||i!==5||fields.includes('manager'));return <KdosChart option={options[(view==='overview'?shortIds:fullIds)[i]!]??{}} height={view==='overview'?'100%':i===5?460:380} empty={!allowed} emptyText="无相关字段读取权限" ariaLabel={(view==='overview'?shortTitles:fullTitles)[i]!}/>;};
 const columns=plmProjectColumns.filter(([key])=>fields.includes(key));
 const rows=useMemo(()=>[...(response?.data?.projects??[])].sort((a,b)=>(fields.includes('progress')?(b.progress??0)-(a.progress??0):0)||(fields.includes('no')?String(a.no).localeCompare(String(b.no)):0)),[response?.data,fields]);
 const exportRows=async()=>{setExporting(true);try{await downloadApiFile('/rd/project-progress/export/projects?fields='+encodeURIComponent(columns.map(([key])=>key).join(',')),'plm-project-progress.xlsx');}catch{message.error('导出失败，请检查权限或稍后重试');}finally{setExporting(false);}};
 const user=JSON.parse(localStorage.getItem('sessionUser')??'{}');
 const cell=(p:Partial<PlmProject>,key:typeof plmProjectColumns[number][0])=>key==='health'?<span><i className={`dot ${p.health==='red'?'red':p.health==='green'?'green':''}`}/>{p.health==='red'?'红色预警':p.health==='green'?'绿色正常':'未标记'}</span>:key==='progress'?<><span>{p.progress}%</span><div className="pbar"><i style={{width:`${p.progress}%`}}/></div></>:p[key]??'—';
 return <div className="plm-progress-page">
  <div className="plm-progress-toolbar"><Segmented aria-label="项目进度视图" value={view} onChange={setView} options={[{label:'单屏总览',value:'overview'},{label:'完整明细',value:'full'}]}/><div className="plm-sync-line"><span>数据来源：A1-PLM</span><span>最近成功：{displayTime(response?.lastSuccessAt??null)}</span><span>最近同步：{response?stateLabels[response.lastResult]:'读取中'}</span></div>{(user.isSystemAdmin||user.moduleAdminCodes?.includes('rd'))&&<Button href="/permissions/rd-plm-project-progress?from=/rd/reports/project-progress">权限管理</Button>}</div>
  {snapshot.isError&&<Alert type="error" showIcon message="无法读取PLM快照，请检查访问权限或稍后重试"/>}
  {response&&(response.lastResult==='FAILED'||response.stale||response.errorCode)&&<Alert style={{marginBottom:12}} type="warning" showIcon message={response.data?`${response.lastResult==='FAILED'||response.errorCode?'同步异常':'数据过期'}，正在展示最近成功快照`:'尚无成功同步的PLM数据'} description="后台每30分钟同步，页面只读取KDOS快照。"/>}
  {snapshot.isPending?<Spin/>:!data?<Empty description="尚无可显示的成功快照"/>:view==='overview'?<div ref={viewport} className="plm-overview" style={{height}}><div className="app">
   <header className="bar"><div className="plm-brand"><h1>PLM 项目控制室<em>_</em>总览</h1><span className="tag">A1-PLM · {displayTime(response?.lastSuccessAt??null)}</span></div>{fields.includes('overview')&&<Kpis data={data}/>}</header>
   <main className="grid">{shortTitles.map((title,i)=><section className="panel" key={title}><h2>{title}</h2><div className="chart">{chart(i)}</div></section>)}</main>
   <footer className="ticker"><span className="lamp"/><span>{fields.includes('overview')&&<><b>{data.kpis.redProjects}/{data.kpis.detail}</b> 项目处于红色预警</>}{fields.includes('msRed')&&fields.includes('msGreen')&&<> · 里程碑红绿比 {data.projects.reduce((n,p)=>n+p.msRed,0)} : {data.projects.reduce((n,p)=>n+p.msGreen,0)}</>}{fields.includes('start')&&data.startMonths.length>0&&<> · 启动月份 {data.startMonths[0]!.month} ~ {data.startMonths.at(-1)!.month}</>}</span><span className="muted">数据来源：A1-PLM</span></footer>
  </div></div>:<div className="plm-full"><article className="page"><header className="hero"><h1><span>PLM 项目数据看板</span></h1><p className="sub">数据来源：A1-PLM 产品生命周期管理系统 ｜ 数据时间：<strong>{displayTime(response?.lastSuccessAt??null)}</strong> ｜ 明细范围：<strong>项目启动完成阶段的看板明细项目</strong></p></header>
   {fields.includes('overview')&&<Kpis data={data} full/>}
   <section><h2>项目状态与分布</h2><p className="sec-note">系统全部项目与看板明细分别统计。</p><div className="chart-grid">{[0,1].map(i=><figure className="chart-figure card" key={i}><figcaption>{fullTitles[i]}{fields.includes('overview')?`（${i===0?'系统全部 '+data.kpis.total:'明细 '+data.kpis.detail} 个项目）`:''}</figcaption>{chart(i)}</figure>)}</div></section>
   <section><h2>进度与节奏</h2><div className="chart-grid">{[2,3,4].map(i=><figure className={`chart-figure card ${i===4?'full':''}`} key={i}><figcaption>{fullTitles[i]}</figcaption>{chart(i)}</figure>)}</div></section>
   <section><h2>里程碑与任务负载</h2><div className="chart-grid">{[5,6,7].map(i=><figure className={`chart-figure card ${i===5?'full':''}`} key={i}><figcaption>{fullTitles[i]}</figcaption>{chart(i)}</figure>)}</div></section>
   <section><div className="table-heading"><h2>项目明细</h2>{hasResourcePermission(plmProgressResource,'export')&&columns.length>0&&<Button loading={exporting} onClick={()=>void exportRows()}>导出本表</Button>}</div><p className="sec-note">看板明细项目全量列表；红绿灯和进度使用PLM原始标记。</p><div className="table-wrap"><table aria-label="PLM项目明细"><thead><tr>{columns.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((p,i)=><tr key={i}>{columns.map(([key])=><td key={key}>{cell(p,key)}</td>)}</tr>)}</tbody></table></div></section>
   <footer>数据来源：A1-PLM · 每30分钟后台同步，页面自动读取最新成功快照。</footer>
  </article></div>}
 </div>;
}
