import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalTypeScript} from '../scripts/load-local-typescript.mjs';
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
