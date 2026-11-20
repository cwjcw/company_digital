import { Injectable } from '@nestjs/common';
export class PlmFetchError extends Error {constructor(readonly code:string){super(code);}}
/** Server-only adapter. Never logs URLs, response bodies, authentication or business rows. */
@Injectable()
export class PlmClient {
 async fetchSnapshot():Promise<{summary:unknown;detail:unknown}> {
  const base=process.env.PLM_BASE_URL,username=process.env.PLM_USERNAME,password=process.env.PLM_PASSWORD;
  if(!base||!username||!password)throw new PlmFetchError('PLM_CONFIG_MISSING');
  let url:URL;try{url=new URL(base);}catch{throw new PlmFetchError('PLM_CONFIG_INVALID');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new PlmFetchError('PLM_CONFIG_INVALID');
  const root=base.replace(/\/$/,'')+'/restApi';let cookies='';
  const request=async(path:string,body:object,ticket?:string):Promise<Record<string,unknown>>=>{
   let last='PLM_REQUEST_FAILED';
   for(let attempt=0;attempt<3;attempt++){
    try {
     const response=await fetch(root+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json;charset=UTF-8',...(ticket?{'Share-Token':ticket}:{}),...(cookies?{Cookie:cookies}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
     if(!response.ok){last=response.status===401||response.status===403?'PLM_AUTH_FAILED':'PLM_HTTP_FAILED';await response.body?.cancel();if(response.status<500&&response.status!==429)throw new PlmFetchError(last);if(attempt<2){await new Promise(r=>setTimeout(r,400*(attempt+1)));continue;}throw new PlmFetchError(last);}
     if(!ticket)cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
     const reader=response.body?.getReader();if(!reader)throw new PlmFetchError('PLM_RESPONSE_INVALID');
     const chunks:Uint8Array[]=[];let length=0;
     try {for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>10*1024*1024){await reader.cancel();throw new PlmFetchError('PLM_RESPONSE_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
     let result:unknown;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PlmFetchError('PLM_RESPONSE_INVALID');}
     if(!result||typeof result!=='object'||Array.isArray(result))throw new PlmFetchError('PLM_RESPONSE_INVALID');return result as Record<string,unknown>;
    }catch(error){if(error instanceof PlmFetchError)throw error;last=error!==null&&typeof error==='object'&&'name' in error&&['TimeoutError','AbortError'].includes(String(error.name))?'PLM_TIMEOUT':'PLM_NETWORK_FAILED';if(attempt<2)await new Promise(r=>setTimeout(r,400*(attempt+1)));}
   }
   throw new PlmFetchError(last);
  };
  const login=await request('/api/login',{username,password});
  const ticket=(login.data as {ticket?:unknown}|undefined)?.ticket;
  if(typeof ticket!=='string'||!ticket||ticket.length>8192||/[\r\n]/.test(ticket))throw new PlmFetchError('PLM_AUTH_FAILED');
  const summary=await request('/sharepm/analyse/kanban/getProjectDetail',{},ticket);
  const detail=await request('/sharepm/analyse/kanban/getAllProjectDetail',{},ticket);
  return {summary,detail};
 }
}
