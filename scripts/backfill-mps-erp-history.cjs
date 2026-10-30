#!/usr/bin/env node
/** Reviewed maintenance command, not a new server route or recurring import.
 * Input via stdin: {accessToken,scope}. Token never enters argv/files/output.
 * Runs the compiled Application command inside the existing API runtime without
 * bootstrapping Nest/schedulers or replacing its running application code. */
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
let raw='';process.stdin.on('data',x=>raw+=x);process.stdin.on('end',()=>{
 try{
  const input=JSON.parse(raw);if(!input.accessToken||!input.scope)throw Error('Authenticated token and reviewed scope required');
  if(!process.argv.includes('--apply'))throw Error('Explicit --apply required; prepare the read-only source/version manifest first');
  const files={command:'modules/master-plan-system/master-plan.erp-history-backfill.js',base:'modules/master-plan-system/master-plan.monthly-base.js',migration:'migrations/1722920111500-MpsHistoricalUnknownAmount.js'};
  const modules=Object.fromEntries(Object.entries(files).map(([k,f])=>[k,fs.readFileSync(path.join(root,'apps/api/dist',f),'utf8')]));
  const hashes=Object.fromEntries(Object.entries(modules).map(([k,code])=>[k,crypto.createHash('sha256').update(code).digest('hex')]));
  const worker=String.raw`
   const fs=require('fs'),path=require('path'),Module=require('module'),{DataSource,MigrationExecutor,Migration}=require('typeorm');
   const crypto=require('crypto');let raw='';process.stdin.on('data',x=>raw+=x);process.stdin.on('end',async()=>{let db;
    try{const input=JSON.parse(raw);
     const res=await fetch('http://127.0.0.1:15173/api/v1/auth/me',{headers:{Authorization:'Bearer '+input.accessToken}});
     if(!res.ok)throw Error('Current authentication failed: '+res.status);const user=await res.json();
     if(!user.isSystemAdmin||!user.sub)throw Error('Current system administrator required');
     const actor={tenantId:process.env.KDOS_DEFAULT_TENANT_CODE||'KAINAN',userId:user.sub,username:user.username,isSystemAdmin:true,permissions:user.permissions||[],tableDataScopes:[],requestId:input.scope.requestId,source:'system'};
     const load=(name,relative,overrides={})=>{const code=input.modules[name];if(crypto.createHash('sha256').update(code).digest('hex')!==input.hashes[name])throw Error('Module integrity mismatch');
      const filename=path.join(process.cwd(),'dist',relative),m=new Module(filename,module);m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);m.require=request=>overrides[request]||original(request);m._compile(code,filename);return m.exports;};
     const base=load('base','modules/master-plan-system/master-plan.monthly-base.js');
     const command=load('command','modules/master-plan-system/master-plan.erp-history-backfill.js',{'./master-plan.monthly-base':base});
     const {MpsHistoricalUnknownAmount1722920111500:Compat}=load('migration','migrations/1722920111500-MpsHistoricalUnknownAmount.js');
     db=new DataSource({type:'postgres',host:process.env.DATABASE_HOST,port:+process.env.DATABASE_PORT,username:process.env.DATABASE_USER,password:process.env.DATABASE_PASSWORD,database:process.env.DATABASE_NAME,logging:false,poolSize:2});await db.initialize();
     const [grant]=await db.query('SELECT system_admin FROM administrator_grants WHERE tenant_id=$1 AND user_id=$2::uuid',[actor.tenantId,actor.userId]);if(!grant?.system_admin)throw Error('Administrator grant revoked');
     const runner=db.createQueryRunner();await runner.connect();await runner.startTransaction();
     try{await runner.query("SELECT set_config('lock_timeout','5000',true)");const executor=new MigrationExecutor(db,runner),instance=new Compat();
      if(!(await executor.getExecutedMigrations()).some(x=>x.name===instance.name))await executor.executeMigration(new Migration(undefined,1722920111500,instance.name,instance));
      await runner.commitTransaction();
     }catch(e){await runner.rollbackTransaction();throw e;}finally{await runner.release();}
     const result=await new command.MasterPlanErpHistoryBackfill(db).apply(input.scope,actor);
     console.log(JSON.stringify({status:'SUCCESS',requestId:input.scope.requestId,moduleHashes:input.hashes,result}));
    }catch(e){console.error(e.message);process.exitCode=1}finally{if(db?.isInitialized)await db.destroy()}
   });`;
  const result=spawnSync('docker',['exec','-i','knplan-api-1','node','-e',worker],{input:JSON.stringify({...input,modules,hashes}),encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
  process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)throw result.error;process.exitCode=result.status||0;
 }catch(e){console.error(e.message);process.exitCode=1}
});
