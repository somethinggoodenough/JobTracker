import {readFileSync} from 'node:fs';
for(const name of process.argv.slice(2)) {
 const html=readFileSync(`outputs/adapter-probes/${name}.txt`,'utf8');
 console.log('\nPAGE',name);
 if (name === 'google-0') {
   for(const m of html.matchAll(/AF_initDataCallback\(\{key: 'ds:1',[\s\S]*?data:([\s\S]*?), sideChannel:/g)) {const d=JSON.parse(m[1]);console.log('GOOGLE ARRAY',JSON.stringify(d[0][0],null,2));console.log('ROOT',d.length,d.map(x=>Array.isArray(x)?`array:${x.length}`:x));} continue;
 }
 if (name === 'microsoft-0' || name === 'qualcomm-0') {
   const block=html.match(/<code id="pcsx-data"[^>]*>([\s\S]*?)<\/code>/)?.[1];
   if(block){const d=JSON.parse(block.replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replaceAll('&amp;','&'));console.log('PCSX keys',Object.keys(d));for(const [k,v] of Object.entries(d))if(k!=='configs')console.log(k,JSON.stringify(v).slice(0,3000));}
   console.log('SCRIPTS',[...html.matchAll(/<script[^>]*src="([^"]+)/g)].map(x=>x[1]).filter(x=>x.includes('gen/')));continue;
 }
 try {const d=JSON.parse(html);const j=d.jobs?.[0]?.data||d.items?.[0]?.requisitionList?.[0]||d.data?.positions?.[0]||d.Data?.Posts?.[0];console.log('ROOT',Object.keys(d),Object.keys(d.data||{}));console.log(JSON.stringify(j||d,(k,v)=>typeof v==='string'?v.slice(0,500):v,2).slice(0,10000));continue;}catch{}
 for(const pattern of [/https?:[^\s"'<>]+(?:api|jobs|greenhouse|ashby|workday)[^\s"'<>]*/gi,/.{0,150}(?:positions|pcsx|_initial|job_list|jobList|api\/apply|AF_initDataCallback|__NEXT_DATA__|JobPosting|jobs\/results|jobsearch\/job-details|position_list|jobListings|requisition).{0,450}/gi]) console.log([...html.matchAll(pattern)].slice(0,18).map(x=>x[0]).join('\n'));
}
