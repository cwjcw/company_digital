import 'reflect-metadata';
import {createHash} from 'node:crypto';
import {DataSource} from 'typeorm';
import original from './data-source';
import {MpsAutomaticDemandConsistency1722920129000} from './migrations/1722920129000-MpsAutomaticDemandConsistency';

/** One explicit migration; never discovers or executes the general pending set. */
async function main(){
 const args=new Map<string,string>();
 for(const arg of process.argv.slice(2)){const [k,...v]=arg.split('=');if(!['--preflight','--execute','--expected-host','--expected-database','--migration','--confirm'].includes(k)||args.has(k))throw Error('Invalid migration argument');args.set(k,v.join('=')||'true');}
 const execute=args.has('--execute');
 if(execute===args.has('--preflight')||args.get('--migration')!=='1722920129000'
   ||!args.get('--expected-host')||!args.get('--expected-database')||execute&&args.get('--confirm')!=='APPLY-MPS-AUTOMATIC-CONSISTENCY-129')throw Error('Explicit preflight/execute, target and migration129 confirmation required');
 const options=original.options;if(options.type!=='postgres'||options.host!==args.get('--expected-host')||options.database!==args.get('--expected-database'))throw Error('Configured database differs from explicit target');
 const db=new DataSource({...options,entities:[],subscribers:[],migrations:[MpsAutomaticDemandConsistency1722920129000],logging:false,
   extra:{...options.extra,options:'-c lock_timeout=5000 -c statement_timeout=120000'}});await db.initialize();
 try{
  const ledger=await db.query('SELECT timestamp,name FROM migrations ORDER BY timestamp');
  if(ledger.some((m:any)=>Number(m.timestamp)===1722920120000||Number(m.timestamp)>1722920129000))throw Error('Lifecycle120 or unknown future schema is outside this release');
  for(const timestamp of [1722920119000,1722920121000,1722920122500,1722920128000])if(!ledger.some((m:any)=>Number(m.timestamp)===timestamp))throw Error('Missing required baseline '+timestamp);
  const applied=ledger.some((m:any)=>Number(m.timestamp)===1722920129000);
  if(!applied){
   const hashes:Record<string,string>={mps_guard_demand_parent:'f41397671bbc7e8035a110c22eaecb20f4b1b301b7dc751ba7322b38ae0c160b',mps_guard_executed_plan_identity:'ec9be8f48a6f0558021b6ce1fde2c3416ca13a78f4d821589ddc556a56972a53'};
   for(const [name,expected]of Object.entries(hashes)){const [r]=await db.query('SELECT pg_get_functiondef($1::regprocedure) definition',[name+'()']);if(createHash('sha256').update(r.definition).digest('hex')!==expected)throw Error('Baseline guard changed: '+name);}
  }
  if(execute&&!applied){const done=await db.runMigrations({transaction:'all'});if(done.length!==1||done[0]?.name!=='MpsAutomaticDemandConsistency1722920129000')throw Error('Unexpected executed migration set');}
  console.log(JSON.stringify({status:execute?'APPLIED':'PREFLIGHT_OK',migration:'1722920129000',alreadyApplied:applied,businessDataDml:false}));
 }finally{await db.destroy();}
}
void main().catch(e=>{console.error(e.message);process.exitCode=1});
