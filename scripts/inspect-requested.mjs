import fs from 'node:fs';
const audit=JSON.parse(fs.readFileSync('outputs/requested-adapter-audit.json','utf8')).sources;
const ids=process.argv.slice(2).map(Number);
for(const s of audit.filter(s=>!ids.length||ids.includes(s.i))){
 const file=`outputs/requested-adapter-probes/${s.i}.html`;if(!fs.existsSync(file))continue;
 const html=fs.readFileSync(file,'utf8');
 console.log(JSON.stringify({i:s.i,name:s.name,scripts:s.scripts}));
 const patterns=[/.{0,65}(?:__NEXT_DATA__|__INITIAL_STATE__|__SSR_DATA__|__INIT_DATA__|window\.__|job_post_list|job_search|jobSearch|searchJobs|jobId|graphql|JobPosting|positionList|api\/|\.json\?).{0,160}/gi];
 for(const p of patterns)console.log([...html.matchAll(p)].slice(0,12).map(m=>m[0]).join('\n'));
}
