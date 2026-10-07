/* Administrative CLI: all writes go through the production Application Command. */
const fs = require('node:fs');
const path = require('node:path');
const apiRoot=process.env.PMC_RD_API_ROOT || path.resolve(__dirname,'../../apps/api');
const load=name=>require(path.join(apiRoot,'dist',name));
const dataSource=load('data-source').default;
const {PmcRdProgressReader}=load('integrations/e10/pmc-rd-progress.reader');
const {PmcRdProgressCalculator}=load('modules/pmc-rd-progress/pmc-rd-progress.calculator');
const {PmcRdProgressApplicationService}=load('modules/pmc-rd-progress/pmc-rd-progress.application.service');
(async()=>{
  const mode=process.argv[2];if(!['FULL','INCREMENTAL'].includes(mode))throw new Error('Usage: run-pmc-rd-progress-sync.cjs FULL|INCREMENTAL [private capture directory]');
  const captureDir=process.argv[3];if(captureDir){fs.mkdirSync(captureDir,{recursive:true,mode:0o700});}
  await dataSource.initialize();const reader=new PmcRdProgressReader();const calculator=new PmcRdProgressCalculator();
  const read=reader.read.bind(reader);let sourceReadMs=0;reader.read=async(...args)=>{const started=performance.now();const facts=await read(...args);sourceReadMs=performance.now()-started;if(captureDir){fs.writeFileSync(path.join(captureDir,'facts.json'),JSON.stringify(facts),{mode:0o600});fs.writeFileSync(path.join(captureDir,'typescript.json'),JSON.stringify(calculator.calculate(facts)),{mode:0o600});}return facts;};
  const service=new PmcRdProgressApplicationService(dataSource,reader,calculator);
  const actor={tenantId:process.env.KDOS_DEFAULT_TENANT_CODE || 'KAINAN',userId:'0199e000-0000-7000-8000-000000000001',username:'pmc-rd-sync',isSystemAdmin:true,permissions:['*'],moduleAdminCodes:['planning'],tableDataScopes:[],requestId:`pmc-rd-cli-${Date.now()}`,source:'system'};
  const started=performance.now();const result=await service.sync(mode,actor);const report={...result,sourceReadSeconds:Number((sourceReadMs/1000).toFixed(3)),elapsedSeconds:Number(((performance.now()-started)/1000).toFixed(3))};
  if(captureDir)fs.writeFileSync(path.join(captureDir,'sync-result.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(dataSource.isInitialized)await dataSource.destroy();});
