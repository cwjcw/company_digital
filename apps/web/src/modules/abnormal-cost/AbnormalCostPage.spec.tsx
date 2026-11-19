import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, Form } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../api';
import { AbnormalCostPage, ResponsibilityAllocationEditor } from './AbnormalCostPage';
vi.mock('../../api',()=>({api:vi.fn()}));
vi.mock('../../shared/KdosDataTable',async()=>{
  const actual=await vi.importActual<typeof import('../../shared/KdosDataTable')>('../../shared/KdosDataTable');
  return {...actual,KdosDataTable:({toolbar,onRecordDoubleClick,dataSource}:any)=><div>{toolbar}{dataSource?.map((r:any)=><button key={r.id} onDoubleClick={()=>onRecordDoubleClick(r,{page:1,pageSize:100,rowIndex:0,total:1})}>记录{r.category_name}</button>)}</div>};
});
const options={users:[{id:'admin',name:'合成管理员',username:'admin',enabled:true}],departments:[],categories:[],severities:[{id:'s1',severity_name:'一般',amount_min:'0.00',amount_max:'1000.00'},{id:'s2',severity_name:'重大',amount_min:'1000.01',amount_max:'2000.00'}],systemAdminId:'admin'};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
beforeEach(()=>{localStorage.clear();localStorage.setItem('sessionUser',JSON.stringify({sub:'admin',permissions:['*'],isSystemAdmin:true}));vi.mocked(api).mockImplementation(async(path)=>{
  if(path==='/abnormal-cost/options')return options as never;
  if(path.startsWith('/table-filters/rows'))return {rows:[],total:0,page:1,pageSize:100} as never;
  return {} as never;
});});
function page(kind='requests'){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<StrictMode><App><QueryClientProvider client={client}><MemoryRouter initialEntries={[`/workflow/abnormal-cost/${kind}`]}><Routes><Route path="/workflow/abnormal-cost/:kind" element={<AbnormalCostPage/>}/></Routes></MemoryRouter></QueryClientProvider></App></StrictMode>);}
describe('Abnormal cost business forms',()=>{
  it('opens the responsive request form with the ordered fields, attachments, and linked judgments',async()=>{
    page();fireEvent.click(screen.getByRole('button',{name:/新增/}));await screen.findByText('下载明细附件模板');
    expect(screen.getByDisplayValue('提交后自动生成')).toBeInTheDocument();
    expect(screen.getByText('基本信息')).toBeInTheDocument();expect(screen.getByText('附件资料')).toBeInTheDocument();expect(screen.getByText('责任划分')).toBeInTheDocument();
    expect(screen.getByLabelText('客户')).toBeInTheDocument();expect(screen.getByLabelText('订单号')).toBeInTheDocument();expect(screen.getByLabelText('事业部')).toBeInTheDocument();
    expect(screen.getByText('添加责任判定')).toBeInTheDocument();expect(screen.getByText('异常类别')).toBeInTheDocument();expect(screen.getByText(/关联记录/)).toBeInTheDocument();
    expect(screen.queryByText('责任比例合计：')).not.toBeInTheDocument();
    expect(document.querySelector('.abnormal-request-modal')).toBeInTheDocument();expect(document.querySelector('.abnormal-request-modal .ant-modal-footer')).toBeInTheDocument();
  });
  it('defaults confirmed money and recomputes severity while retaining a manual confirmed value',async()=>{
    page();fireEvent.click(screen.getByRole('button',{name:/新增/}));await screen.findByText('下载明细附件模板');
    const estimated=screen.getByLabelText('预估金额'),confirmed=screen.getByLabelText('核定金额');await waitFor(()=>expect(estimated).toBeEnabled());
    fireEvent.change(estimated,{target:{value:'100'}});await waitFor(()=>expect(confirmed).toHaveValue('100.00'));
    await waitFor(()=>expect(screen.getByDisplayValue('一般')).toBeInTheDocument());
    fireEvent.change(confirmed,{target:{value:'1500'}});fireEvent.blur(confirmed);await waitFor(()=>expect(screen.getByDisplayValue('重大')).toBeInTheDocument());
    fireEvent.change(estimated,{target:{value:'200'}});await waitFor(()=>expect(confirmed).toHaveValue('1,500.00'));
  });
  it('does not offer create or import actions to a read-only member',async()=>{localStorage.setItem('sessionUser',JSON.stringify({permissions:['abnormal-categories:*:read']}));page('categories');expect(screen.queryByRole('button',{name:/新增/})).not.toBeInTheDocument();expect(screen.queryByText('导入')).not.toBeInTheDocument();});
  it('opens the independent judgment table for assigned members without global table permission',async()=>{
    localStorage.setItem('sessionUser',JSON.stringify({sub:'assigned-user'}));page('judgments');
    await waitFor(()=>expect(vi.mocked(api)).toHaveBeenCalledWith(expect.stringContaining('/table-filters/rows?resource=abnormal-responsibility-judgments')));
    expect(screen.queryByText('没有此页面的访问权限')).not.toBeInTheDocument();
    cleanup();localStorage.setItem('sessionUser',JSON.stringify({sub:'assigned-user'}));page('judgments');
    await waitFor(()=>expect(vi.mocked(api)).toHaveBeenCalledWith(expect.stringContaining('/table-filters/rows?resource=abnormal-responsibility-judgments')));
  });
  it('keeps the company assignee read-only and hides row deletion without delete permission',async()=>{
    function TestForm(){const [form]=Form.useForm();return <Form form={form} initialValues={{responsibility_allocations:[{id:'row-1',personnel_type:'公司',company_description:'公司',responsible_user_id:'admin',personnel_level:'经理',responsibility_ratio:'100.0',adjusted_ratio:'100.0'}]}}><ResponsibilityAllocationEditor form={form} options={options} canDelete={false}/></Form>;}
    render(<App><TestForm/></App>);await screen.findByText('责任比例合计：100.0%；申诉后责任比例合计：100.0%');expect(screen.queryByLabelText('删除责任划分第1行')).not.toBeInTheDocument();expect(screen.getByText('合成管理员（admin）').closest('.ant-select')).toHaveClass('ant-select-disabled');expect(screen.getByRole('button',{name:/添加/})).toBeInTheDocument();
  });
});
