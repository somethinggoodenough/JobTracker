import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const {selectedApplicationResume}=loadLocalTypeScript('lib/application-resume.ts');
const {applicationInput,positiveId,isApplicationStatus}=loadLocalTypeScript('lib/application-types.ts');
const valid={resume:' resume-v3.pdf ',email:' me@example.com ',status:'applied',applied_at:'2026-11-17T10:30:00-05:00',status_at:'2026-11-17T10:35:00-05:00',version:1};
test('Application dates retain explicit timezone, and draft fields can be blank',()=>{
 const input=applicationInput(valid); assert.equal(input.appliedAt,'2026-11-17T15:30:00.000Z');
 assert.equal(input.statusAt,'2026-11-17T15:35:00.000Z'); assert.equal(input.email,'me@example.com');assert.equal(input.resume,'resume-v3.pdf');
 assert.equal(applicationInput({...valid,applied_at:null,email:'',resume:''}).appliedAt,null);
});
test('Reject malformed application status, dates, email, version and oversized resume',()=>{
 for(const body of [null,[],{...valid,status:'__proto__'},{...valid,status:'made-up'}, {...valid,email:'invalid'},
  {...valid,status_at:'2026-02-30T10:00:00Z'},{...valid,status_at:'2026-11-17T24:00:00Z'},
  {...valid,applied_at:'2026-11-17T10:00'}, {...valid,version:0}, {...valid,version:1.5}, {...valid,resume:'x'.repeat(4001)}]) assert.throws(()=>applicationInput(body));
 assert.equal(isApplicationStatus('constructor'),false);assert.equal(isApplicationStatus('saved'),true);
 for(const id of [null,true,{},'-1','1 OR 1=1',0,1.5])assert.throws(()=>positiveId(id));
 assert.equal(positiveId('12'),12);
});

test('Resume choices distinguish keeping the saved version, selecting and explicitly clearing',()=>{
 assert.deepEqual(applicationInput(valid).resumeChoice,{changed:false,id:null,version:null});
 assert.deepEqual(applicationInput({...valid,resume_id:12,resume_version:3}).resumeChoice,{changed:true,id:12,version:3});
 assert.deepEqual(applicationInput({...valid,resume_id:null}).resumeChoice,{changed:true,id:null,version:null});
 for(const patch of [{resume_id:1},{resume_id:1,resume_version:0},{resume_id:-1,resume_version:1},{resume_id:null,resume_version:1},{resume_version:1},{resume_snapshot:{name:'forged'}}])assert.throws(()=>applicationInput({...valid,...patch}));
});

test('Application resume metadata comes from the library and rejects deleted or outdated choices',async()=>{
 const sqlite=new DatabaseSync(':memory:');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8'));
 const db={prepare(sql){let values=[];return{bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;}};}};
 try{
 sqlite.prepare("INSERT INTO resumes(name,target_role,created_at,tech_stack,content,pdf_name,pdf_key,recorded_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run('Backend v1','Backend intern','2026-11-18T12:00:00Z','["Go","PostgreSQL"]','Private body','resume.pdf','private/storage/key','2026-11-18','2026-11-18');
 const snapshot=await selectedApplicationResume(db,{changed:true,id:1,version:1});assert.equal(snapshot.name,'Backend v1');assert.equal(snapshot.pdf_name,'resume.pdf');assert.deepEqual(snapshot.tech_stack,['Go','PostgreSQL']);assert(!('content' in snapshot));assert(!('pdf_key' in snapshot));assert.equal(snapshot.version,1);
 sqlite.exec("UPDATE resumes SET name='Backend v2',version=2 WHERE id=1");assert.equal(snapshot.name,'Backend v1');
 await assert.rejects(()=>selectedApplicationResume(db,{changed:true,id:1,version:1}),/已更新/);
 assert.equal((await selectedApplicationResume(db,{changed:true,id:1,version:2})).name,'Backend v2');
 sqlite.exec('DELETE FROM resumes WHERE id=1');await assert.rejects(()=>selectedApplicationResume(db,{changed:true,id:1,version:2}),/已删除/);
 assert.equal(await selectedApplicationResume(db,{changed:false,id:1,version:1}),null);assert.equal(await selectedApplicationResume(db,{changed:true,id:null,version:null}),null);
 }finally{sqlite.close();}
});
