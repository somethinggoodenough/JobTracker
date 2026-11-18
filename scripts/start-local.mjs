import {fork, spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url));
const state=path.resolve(root,process.env.JOB_RADAR_LOCAL_STATE_DIR || '.wrangler/state');
// Wrangler resolves --env-file against both cwd and its config directory. An absolute
// path loads the one root .env in both places, without copying or bundling credentials.
const envFile=path.join(root,'.env');
const runtime=path.join(root,'.sites-runtime');
mkdirSync(runtime,{recursive:true});
const key=randomBytes(32).toString('hex');
const localBindings=path.join(runtime,`crawler-${process.pid}.env`);
let worker, port=0, stopping=false, restartTimer;

function startCrawler() {
  worker=fork(path.join(root,'scripts/local-crawler.mjs'),[],{
    cwd:root,windowsHide:true,execArgv:['--max-old-space-size=512'],
  });
  const child=worker;
  child.on('error',error=>console.error('Local crawler process:',error.message));
  child.on('exit',()=>{
    if (!stopping && port) restartTimer=setTimeout(()=>{
      startCrawler().catch(error=>console.error(error.message));
    },1000);
  });
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Local crawler did not start'));},10000);
    child.once('message',message=>{clearTimeout(timeout);resolve(message.port);});
    child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Local crawler exited during startup'));});
    child.send({port,key,filename:path.join(state,'crawl-details.sqlite')});
  });
}

mkdirSync(state,{recursive:true});
port=await startCrawler();
writeFileSync(localBindings,`JOB_RADAR_CRAWLER_PORT=${port}\nJOB_RADAR_CRAWLER_KEY=${key}\n`,{mode:0o600});
const child=spawn(process.execPath,['--import',new URL('./sites-env.mjs',import.meta.url).href,
 path.join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--config',path.join(root,'dist/server/wrangler.json'),
 ...(existsSync(envFile)?['--env-file',envFile]:[]),'--local','--persist-to',state,
 '--env-file',localBindings,
 '--ip','127.0.0.1','--inspector-port','0',...process.argv.slice(2)],{cwd:root,stdio:'inherit',windowsHide:true});
function stopCrawler() {
  stopping=true;
  clearTimeout(restartTimer);
  worker.kill();
  rmSync(localBindings,{force:true});
}
child.on('error',()=>{console.error('Could not start local server.');process.exitCode=1;stopCrawler();});
child.on('exit',code=>{process.exitCode=code??0;stopCrawler();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopCrawler();child.kill(signal);});
