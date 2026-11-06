import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { listRuns, readSnapshot, validId } from './snapshot.ts';
import type { Capabilities } from '../src/contracts.ts';

export function createFactoryApi(appRoot:string,backendRoot:string) {
  const roots=[path.join(appRoot,'runs'),path.join(backendRoot,'runs'),path.join(backendRoot,'recorded')];
  const jobs=new Map<string,ChildProcess>();
  const caps=async():Promise<Capabilities>=>{
    let backendAvailable=true;try{await access(path.join(backendRoot,'src/loop/solve.ts'));}catch{backendAvailable=false;}
    const liveReady=backendAvailable&&!!(process.env.CRUSOE_API_KEY||process.env.FACTORY_SECRET_ENV);
    return {backendAvailable,liveReady,liveReason:liveReady?'Ready for a bounded Crusoe run.':'Start the server with the existing 1Password environment to enable live agents.',maxSpendUsd:.5,maxCalls:40};
  };
  const json=(res:ServerResponse,status:number,data:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data));};
  async function body(req:IncomingMessage){let text='';for await(const chunk of req){text+=chunk;if(text.length>8192)throw new Error('body too large');}return JSON.parse(text||'{}');}
  async function middleware(req:IncomingMessage,res:ServerResponse,next:()=>void){
    if(!req.url?.startsWith('/api/'))return next();
    const url=new URL(req.url,'http://localhost'),parts=url.pathname.split('/').filter(Boolean);
    try{
      if(req.method==='GET'&&url.pathname==='/api/capabilities')return json(res,200,await caps());
      if(req.method==='GET'&&url.pathname==='/api/runs')return json(res,200,{runs:await listRuns(roots)});
      if(parts[1]==='runs'&&parts[2]&&!validId(parts[2]))return json(res,400,{error:'Invalid run ID.'});
      if(req.method==='GET'&&parts[1]==='runs'&&parts.length===3){const snap=await readSnapshot(roots,parts[2]);return json(res,snap?200:404,snap??{error:'Run not found.'});}
      if(req.method==='POST'){
        const host=req.headers.host??'';if(req.headers.origin!==`http://${host}`||!/^((localhost|127\.0\.0\.1)(:\d+)?)$/.test(host))return json(res,403,{error:'Local same-origin requests only.'});
        if(parts[1]==='runs'&&parts.length===4&&parts[3]==='stop'){
          const job=jobs.get(parts[2]);if(!job)return json(res,404,{error:'No running worker owned by this server.'});
          job.kill('SIGTERM');return json(res,200,{stopping:true});
        }
        if(url.pathname==='/api/runs'){
          if(jobs.size)return json(res,409,{error:'A run is already active. Wait or stop it before starting another.'});
          let data:any;try{data=await body(req);}catch{return json(res,400,{error:'Invalid JSON request body.'});}
          if(!data||Array.isArray(data)||typeof data!=='object')return json(res,400,{error:'Request body must be an object.'});
          const cap=await caps();
          if(data.mode!=='simulator'&&data.mode!=='live')return json(res,400,{error:'Choose simulator or live mode.'});
          if(!cap.backendAvailable)return json(res,503,{error:'Factory N+1 source is unavailable.'});
          if(data.mode==='live'&&(!cap.liveReady||data.allowPaid!==true))return json(res,403,{error:cap.liveReady?'Paid-run authorization is required.':cap.liveReason});
          const generations=Number(data.generations??1);if(!Number.isInteger(generations)||generations<1||generations>3)return json(res,400,{error:'Generations must be 1 to 3.'});
          if(data.goal!==undefined&&data.goal!=='')return json(res,400,{error:'This backend uses its fixed fulfillment goal and executable checks.'});
          const id=`ui-${data.mode}-${Date.now()}-${randomUUID().slice(0,6)}`,dir=path.join(appRoot,'runs',id);
          await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'ui-meta.json'),JSON.stringify({mode:data.mode==='live'?'live':'simulator',state:'running',createdAt:new Date().toISOString(),phase:'Starting backend worker'}));
          const args=process.env.FACTORY_SECRET_ENV?[`--env-file=${process.env.FACTORY_SECRET_ENV}`]:[];
          args.push('--import',path.join(appRoot,'node_modules/tsx/dist/loader.mjs'),fileURLToPath(new URL('./worker.ts',import.meta.url)));
          const child=spawn(process.execPath,args,{cwd:appRoot,env:{...process.env,CALL_BUDGET:'40',SPEND_CAP_USD:'0.49'},stdio:['pipe','ignore','pipe']});
          jobs.set(id,child);let stopped=false;
          const finalize=async(code:number|null,signal:NodeJS.Signals|null)=>{
            if(stopped)return;stopped=true;jobs.delete(id);
            if(code!==0||signal)await writeFile(path.join(dir,'ui-meta.json'),JSON.stringify({mode:data.mode==='live'?'live':'simulator',state:'error',createdAt:new Date().toISOString(),error:signal?'Run stopped. Completed artifacts were preserved.':'Backend worker failed. Check server configuration.'}));
          };
          child.stderr?.resume();child.stdin?.on('error',()=>{});child.on('error',()=>void finalize(1,null));child.on('exit',(code,signal)=>void finalize(code,signal));
          child.stdin!.end(JSON.stringify({id,mode:data.mode,backendRoot,generations,goal:(data.goal??'').trim()}));
          return json(res,202,{id});
        }
      }
      return json(res,404,{error:'Endpoint not found.'});
    }catch{return json(res,503,{error:'Run data is updating or unavailable. Retry shortly.'});}
  }
  return {middleware,caps,close:()=>{for(const job of jobs.values())job.kill('SIGTERM');}};
}
