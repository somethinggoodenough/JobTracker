import fs from 'node:fs';
for(const file of process.argv.slice(2)){
 const text=fs.readFileSync(file,'utf8');let json;
 try{json=JSON.parse(text.replace(/^for \(;;\);/,''));}catch{
  const block=text.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)?.[1];
  if(block)try{json=JSON.parse(block);}catch{}
 }
 console.log('FILE',file);
 if(!json){console.log(text.slice(0,350));continue;}
 console.log('ROOT',Object.keys(json));let printed=0;
 function walk(value,p,depth=0){if(depth>12||printed>=14||!value||typeof value!=='object')return;
  if(Array.isArray(value)){if(value.length&&typeof value[0]==='object'){printed++;console.log('ARRAY',p,'length',value.length,'first',JSON.stringify(value[0],(k,v)=>typeof v==='string'?v.slice(0,350):v).slice(0,1100));}for(const [i,x]of value.slice(0,2).entries())walk(x,p+'.'+i,depth+1);return;}
  if(('jobId'in value)||('job_id'in value)||('job_post_list'in value)||('jobSearch'in value)||('job_title'in value)){printed++;console.log('JOB',p,JSON.stringify(value,(k,v)=>typeof v==='string'?v.slice(0,180):v).slice(0,1200));}
  for(const [key,v] of Object.entries(value))walk(v,p+'.'+key,depth+1);
 }walk(json,'root');
}
