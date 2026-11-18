import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
const nativeRequire=createRequire(import.meta.url);
const cache=new Map();
export function loadLocalTypeScript(filename){
 filename=path.resolve(filename);
 if(cache.has(filename))return cache.get(filename).exports;
 if(filename.endsWith('.json'))return JSON.parse(fs.readFileSync(filename,'utf8'));
 const module={exports:{}};cache.set(filename,module);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText;
 const require=name=>{
  if(!name.startsWith('.')&&!name.startsWith('@/'))return nativeRequire(name);
  let resolved=name.startsWith('@/')?path.resolve(name.slice(2)):path.resolve(path.dirname(filename),name);
  if(!fs.existsSync(resolved))resolved+='.ts';return loadLocalTypeScript(resolved);
 };
 new Function('require','exports','module',code)(require,module.exports,module);return module.exports;
}
