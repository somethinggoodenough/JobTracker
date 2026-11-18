import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
const {resumeInput,resumeLocalTime,resumeLocalToIso,ResumeInputError}=loadLocalTypeScript('lib/resume-types.ts');
const {createResume,getResume,updateResume,deleteResume,listResumes,ResumeConflict,ResumeNotFound}=loadLocalTypeScript('lib/resumes.ts');
function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){let values=[];return{bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){const result=sqlite.prepare(sql).run(...values);return{meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}};}};
 return{db,sqlite};
}
const input={name:'Backend resume v1',target_role:'Backend / Distributed — New Grad',summary:'Emphasize distributed systems projects.',created_at:'2026-11-18T09:30:00-05:00',tech_stack:['Python','Go','PostgreSQL'],content:'Personal resume content\nProjects and experience'};

test('Resume input normalizes technologies and validates required metadata and dates',()=>{
 const value=resumeInput({...input,tech_stack:[' Python ','python','Ｃ＋＋','C++','CI/CD','Machine   Learning']});
 assert.deepEqual(value.tech_stack,['Python','C++','CI/CD','Machine Learning']);assert.equal(value.created_at,'2026-11-18T14:30:00.000Z');assert.equal(value.content,input.content);
 const now=new Date('2026-11-18T12:00:00Z');assert.equal(resumeInput({name:'Example',target_role:'AI Engineer'},now).created_at,now.toISOString());
 for(const patch of [{name:''},{target_role:' '},{name:'x'.repeat(121)},{summary:'x'.repeat(501)},{content:'x'.repeat(100001)},{created_at:'2026-02-30T12:00:00Z'},{created_at:'2026-11-18T24:00:00Z'},{created_at:'2026-11-18T12:00'},{tech_stack:[1]},{tech_stack:Array.from({length:41},(_,i)=>'tag'+i)},{id:4}])assert.throws(()=>resumeInput({...input,...patch}),ResumeInputError);
});

test('Resume time input is always New York time and handles daylight saving gaps',()=>{
 assert.equal(resumeLocalToIso('2026-11-18T09:30'),'2026-11-18T14:30:00.000Z');
 assert.equal(resumeLocalToIso('2026-07-18T09:30'),'2026-07-18T13:30:00.000Z');
 assert.equal(resumeLocalTime('2026-11-18T14:30:12Z'),'2026-11-18T09:30:12');
 assert.equal(resumeLocalTime(resumeLocalToIso('2026-11-01T01:30')),'2026-11-01T01:30:00');
 assert.throws(()=>resumeLocalToIso('2026-03-08T02:30'),/不存在/);
 assert.throws(()=>resumeLocalToIso('2026-02-30T09:30'));
});

test('Resume create and partial edits retain document content and original creation time',async()=>{
 const {db,sqlite}=database();try{const original=await createResume(db,input);assert.equal(original.version,1);assert.deepEqual(original.tech_stack,input.tech_stack);
 const updated=await updateResume(db,original.id,{summary:'Updated focus',version:original.version});
 assert.equal(updated.summary,'Updated focus');assert.equal(updated.content,input.content);assert.equal(updated.created_at,original.created_at);assert.equal(updated.recorded_at,original.recorded_at);assert.equal(updated.version,2);
 await assert.rejects(()=>updateResume(db,original.id,{content:'overwrite',version:1}),ResumeConflict);assert.equal((await getResume(db,original.id)).content,input.content);
 await assert.rejects(()=>updateResume(db,original.id,{name:'changed'}),ResumeInputError);
 }finally{sqlite.close();}
});

test('Concurrent edits and stale deletes cannot overwrite or remove a newer resume',async()=>{
 const {db,sqlite}=database();try{const original=await createResume(db,input);
 const edits=await Promise.allSettled(['Version A','Version B'].map(name=>updateResume(db,original.id,{name,version:1})));
 assert.equal(edits.filter(result=>result.status==='fulfilled').length,1);assert(edits.find(result=>result.status==='rejected').reason instanceof ResumeConflict);
 await assert.rejects(()=>deleteResume(db,original.id,1),ResumeConflict);const current=await getResume(db,original.id);assert.equal(current.version,2);
 await deleteResume(db,current.id,current.version);await assert.rejects(()=>getResume(db,current.id),ResumeNotFound);
 }finally{sqlite.close();}
});

test('Resume search is literal and paginated, and list responses omit full private document bodies',async()=>{
 const {db,sqlite}=database();try{
 for(let i=0;i<25;i++)await createResume(db,{...input,name:'Resume '+i,tech_stack:i===24?['Rust','C++']:['Python']});
 const first=await listResumes(db,new URL('http://localhost/api/resumes?page=1')),second=await listResumes(db,new URL('http://localhost/api/resumes?page=2'));
 assert.equal(first.pagination.pageSize,12);assert.equal(first.pagination.totalPages,3);assert.equal(first.resumes.length,12);assert.equal(second.resumes.length,12);
 assert(!first.resumes.some(row=>Object.hasOwn(row,'content')));assert(!JSON.stringify(first).includes(input.content));
 const ids=new Set([...first.resumes,...second.resumes].map(row=>row.id));assert.equal(ids.size,24);
 const filtered=await listResumes(db,new URL('http://localhost/api/resumes?q=Rust'));assert.equal(filtered.pagination.total,1);
 const injection=await listResumes(db,new URL('http://localhost/api/resumes?'+new URLSearchParams({q:"' OR 1=1 --"})));assert.equal(injection.pagination.total,0);
 assert.equal((await listResumes(db,new URL('http://localhost/api/resumes?page=999'))).pagination.page,3);
 assert.equal((await listResumes(db,new URL('http://localhost/api/resumes?page=-1'))).pagination.page,1);
 }finally{sqlite.close();}
});

test('Old resume documents survive deletion of expired jobs and their sources',async()=>{
 const {db,sqlite}=database();try{
 sqlite.exec("INSERT INTO sources(name,url) VALUES('Test','https://example.invalid'); INSERT INTO jobs(source_id,source_external_key,dedupe_key,canonical_url,company,title,description,posted_at,first_seen_at,last_seen_at,updated_at) VALUES(1,'test','test','https://example.invalid/job','Test','Old job','JD','2000-01-01','2000-01-01','2000-01-01','2000-01-01');");
 const resume=await createResume(db,{...input,created_at:'2000-01-01T12:00:00Z'});
 sqlite.exec('DELETE FROM jobs; DELETE FROM sources;');assert.equal((await getResume(db,resume.id)).content,input.content);
 assert.equal((await listResumes(db,new URL('http://localhost/api/resumes'))).pagination.total,1);
 }finally{sqlite.close();}
});
