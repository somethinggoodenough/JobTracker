import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url));
// Wrangler resolves --env-file against both cwd and its config directory. An absolute
// path loads the one root .env in both places, without copying or bundling credentials.
const envFile=path.join(root,'.env');
const child=spawn(process.execPath,['--import',new URL('./sites-env.mjs',import.meta.url).href,
 path.join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--config',path.join(root,'dist/server/wrangler.json'),
 ...(existsSync(envFile)?['--env-file',envFile]:[]),'--local','--persist-to',path.join(root,'.wrangler/state'),
 '--ip','127.0.0.1','--inspector-port','0',...process.argv.slice(2)],{cwd:root,stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('Could not start local server.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??0;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
