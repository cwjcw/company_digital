import 'reflect-metadata';
import {DataSource} from 'typeorm';
import original from './data-source';
import {MasterPlanSyncService} from './modules/master-plan-system/master-plan.sync.service';

/** Operator entry for the same bounded scanner/consumer used by runDue. No row IDs or business SQL. */
async function main(){
 const args=new Map(process.argv.slice(2).map(arg=>{const [k,...v]=arg.split('=');return [k,v.join('=')||'true']}));
 if([...args.keys()].some(k=>!['--execute','--pages','--batch-size','--expected-database','--expected-host'].includes(k))||!args.has('--execute'))throw Error('Explicit --execute and target required');
 const pages=Number(args.get('--pages')??1),batch=Number(args.get('--batch-size')??25);
 if(!Number.isInteger(pages)||pages<1||pages>500||!Number.isInteger(batch)||batch<1||batch>100)throw Error('Bounded page/batch limits required');
 const options=original.options;if(options.type!=='postgres'||options.host!==args.get('--expected-host')||options.database!==args.get('--expected-database'))throw Error('Configured database differs from target');
 const db=new DataSource({...options,entities:[],subscribers:[],migrations:[],logging:false});await db.initialize();
 try{const service=new MasterPlanSyncService(db),tenant=process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN';let scanned=0,inconsistent=0,enqueued=0,processed=0;
  for(let page=0;page<pages;page++){const r=await service.scanConsistencyPage(tenant,batch);if(!r.ready)throw Error('Migration129 missing');scanned+=r.scanned;inconsistent+=r.inconsistent;enqueued+=r.enqueued;
    for(let drain=0;drain<Math.ceil(batch/10)+1;drain++){const done=await service.processOutbox();processed+=done;if(!done)break;}
    console.log(JSON.stringify({page:page+1,...r,processed}));if(r.incrementalRows===0&&r.sweepRows===0)break;}
  console.log(JSON.stringify({status:'COMPLETED_BOUNDED_RUN',scanned,inconsistent,enqueued,processed}));
 }finally{await db.destroy();}
}
void main().catch(e=>{console.error(e.message);process.exitCode=1});
