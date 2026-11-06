import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createFactoryApi } from './server/api.ts';
const appRoot=path.dirname(fileURLToPath(import.meta.url));
const backendRoot=path.resolve(appRoot,'..');
// The ignored local file stores a mount path, never credential values.
if(!process.env.FACTORY_SECRET_ENV){try{const local=JSON.parse(readFileSync(path.join(appRoot,'.factory.local.json'),'utf8'));if(typeof local.secretEnv==='string')process.env.FACTORY_SECRET_ENV=local.secretEnv;}catch{}}
export default defineConfig({
  resolve:{dedupe:['three']},
  plugins:[{name:'factory-backend',configureServer(server){const api=createFactoryApi(appRoot,backendRoot);server.middlewares.use((req,res,next)=>void api.middleware(req,res,next));server.httpServer?.once('close',api.close);},configurePreviewServer(server){const api=createFactoryApi(appRoot,backendRoot);server.middlewares.use((req,res,next)=>void api.middleware(req,res,next));server.httpServer?.once('close',api.close);}}],
  server:{host:'127.0.0.1',port:5180,strictPort:true,fs:{allow:[appRoot,backendRoot]}},
});
