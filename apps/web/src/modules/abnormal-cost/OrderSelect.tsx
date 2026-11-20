import {useEffect,useMemo,useState} from 'react';
import {Select,Tooltip,type SelectProps} from 'antd';
import {api} from '../../api';
const completeText=(text:unknown)=><Tooltip title={String(text??'')} trigger={['hover','focus']} getPopupContainer={()=>document.body}><span tabIndex={0} className="abnormal-select-label">{String(text??'')}</span></Tooltip>;
/** Local wrapper only; KDOS global Select styling remains scoped to its owners. */
export function ReadableSelect(props:SelectProps){return <Select showSearch optionFilterProp="label" popupMatchSelectWidth={false} styles={{popup:{root:{maxWidth:'min(680px, calc(100vw - 32px))'}}}} getPopupContainer={()=>document.body} optionRender={option=>completeText(option.label)} labelRender={option=>completeText(option.label??option.value)} {...props}/>;}
type Choice={value:string;label:string};
export function OrderSelect({orderNo,majorCategory,subCategories,...props}:SelectProps&{orderNo?:string;majorCategory?:string;subCategories?:string[]}){
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[choices,setChoices]=useState<Choice[]>([]),[hasMore,setHasMore]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(false);
 const secondary=JSON.stringify(subCategories??[]);
 useEffect(()=>{setSearch('');setPage(1);setChoices([]);},[orderNo,majorCategory,secondary]);
 useEffect(()=>{let active=true;const timer=setTimeout(()=>{
  if(props.mode==='multiple'&&!orderNo){setChoices([]);return;}
  setLoading(true);setError(false);const query=new URLSearchParams({search,page:String(page),majorCategory:majorCategory??'',subCategories:secondary,...(orderNo?{orderNo}:{})});
  void api<{options:Choice[];hasMore:boolean}>(`/abnormal-cost/order-options?${query}`).then(r=>{if(!active)return;setChoices(old=>page===1?r.options:[...old,...r.options.filter(o=>!old.some(p=>p.value===o.value))]);setHasMore(r.hasMore);}).catch(()=>{if(active){setError(true);setHasMore(false);}}).finally(()=>{if(active)setLoading(false);});
 },250);return ()=>{active=false;clearTimeout(timer);};},[orderNo,majorCategory,secondary,search,page,props.mode]);
 const options=useMemo(()=>{const selected=(Array.isArray(props.value)?props.value:props.value?[props.value]:[]) as string[];return [...choices,...selected.filter(v=>!choices.some(c=>c.value===v)).map(v=>({value:v,label:v}))];},[choices,props.value]);
 return <ReadableSelect {...props} filterOption={false} loading={loading} options={options} onSearch={value=>{setSearch(value);setPage(1);}} onPopupScroll={event=>{const e=event.currentTarget;if(hasMore&&!loading&&e.scrollTop+e.clientHeight>=e.scrollHeight-24)setPage(p=>p+1);}} notFoundContent={loading?'正在加载…':error?'加载失败，请重新搜索':orderNo||props.mode!=='multiple'?'无匹配结果':'请先选择订单号'} popupRender={menu=><>{menu}{hasMore&&<div className="abnormal-select-more">继续输入关键字或向下滚动加载更多</div>}{error&&<div role="alert">候选加载失败，请重新搜索</div>}</>}/>;
}
