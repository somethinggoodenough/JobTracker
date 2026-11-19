import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { loadLocalTypeScript } from '../scripts/load-local-typescript.mjs';
import { localD1 } from './local-d1.mjs';

const store = loadLocalTypeScript('lib/planner-store.ts');
const flow = loadLocalTypeScript('lib/planner-workflow.ts');
const { rankToday } = loadLocalTypeScript('lib/planner-rank.ts');
const { cardReview, plannerWeek } = loadLocalTypeScript('lib/planner-rules.ts');
const now = new Date('2026-11-19T19:00:00Z');
const today = '2026-11-19';
const stamp = now.toISOString();
const base = { id: 1, status: 'active', title: 'P', goal_id: null, kind: 'project', last_activity_at: stamp };
const task = (id, fields = {}) => ({ id, title: String(id), project_id: 1, status: 'next', position: 0, ...fields });
const state = (fields = {}) => ({ goals: [], projects: [base], milestones: [], tasks: [], cards: [], ...fields });
const rule = (tasks, extra = {}) => rankToday(state({ tasks, ...extra }), today, 60);
const score = (tasks, extra = {}) => rule(tasks, extra).candidates[0].score;

test('Planner ranks urgency, active tasks, unblocked tasks, milestones, priority, stalled goals and effort', () => {
  for (const [due_on, expected] of [['2026-11-18',100],['2026-11-19',100],['2026-11-20',80],['2026-11-22',60],['2026-11-26',30],['2026-11-27',0]]) {
    assert.equal(score([task(1, { due_on })]), expected);
  }
  assert.equal(score([task(1,{ status:'doing' })]),25);
  assert.equal(score([task(1,{ unblocked_at:'2026-11-17T19:00:00Z' })]),20);
  assert.equal(score([task(1,{ milestone_id:1 })], { milestones:[{id:1,project_id:1,status:'open',position:0,target_on:'2026-11-19'}] }),65);
  assert.equal(score([task(1)], { projects:[{...base,goal_id:1,last_activity_at:'2026-11-14T19:00:00Z'}],
    goals:[{id:1,status:'active',priority:3,created_at:stamp}] }),30);
  assert.equal(score([task(1, { estimate_minutes:30 })]),10);
  assert.equal(score([task(1, { estimate_minutes:80 })]),-40);
  assert.equal(rule([task(1, { due_on:today, estimate_minutes:80 })]).focus.length,0);
  const learning = rule([], { projects:[{...base,kind:'learning'}], cards:Array.from({length:12}, (_,id)=>({id,project_id:1,due_on:today})) });
  assert.deepEqual(learning.focus.map(item=>[item.id,item.reviewCount,item.score]),[[-1,12,40]]);
  assert.deepEqual(rule([task(1,{position:3}),task(9,{position:1}),task(8,{position:1}),task(3,{project_id:2})],
    {projects:[base,{...base,id:2}]}).focus.map(item=>item.id),[3,8,9]);
  assert.deepEqual(rule([task(2,{due_on:'2026-11-26'}),task(1,{due_on:'2026-11-25'})]).focus.map(item=>item.id),[1,2]);
  const warnings = rule([task(1,{status:'blocked',check_back_on:today})],
    {projects:[{...base,last_activity_at:'2026-11-12T19:00:00Z'}]});
  assert.equal(warnings.stalled.length,1); assert.equal(warnings.stale.length,1); assert.equal(warnings.checkBack.length,1);
  assert.equal(plannerWeek('2026-11-22'),'2026-11-16');
});

test('Planner enforces WIP, supports atomic swaps and increases, preserves over-cap work, and checks versions', async t => {
  const { db } = localD1(t);
  const create = (kind,input) => store.savePlannerRow(db,kind,input,undefined,now);
  const patch = (kind,row,changes) => store.savePlannerRow(db,kind,{...changes,version:row.version},row.id,now);
  const settings = await store.plannerSettings(db);
  assert.deepEqual([settings.max_active_projects,settings.max_doing_tasks],[3,2]);
  const projects=[];
  for (let i=0;i<3;i++) projects.push(await create('projects',{title:'project '+i}));
  await assert.rejects(()=>create('projects',{title:'4'}), error=>error.status===409&&error.details.max===3);
  const fourth=await create('projects',{title:'4',resolution:{action:'increase'}});
  assert.equal((await store.plannerSettings(db)).max_active_projects,4);
  const swapped=await create('projects',{title:'5',resolution:{action:'replace',id:projects[0].id}});
  assert.equal((await store.listPlannerRows(db,'projects')).find(x=>x.id===projects[0].id).status,'paused');
  await assert.rejects(()=>patch('projects',projects[0],{description:'stale'}), error=>error.status===409);
  let current=await store.plannerSettings(db);
  for (const max of [0,11,""]) await assert.rejects(()=>store.putPlannerSettings(db,{version:current.version,max_active_projects:max}), error=>error.status===400);
  current=await store.putPlannerSettings(db,{version:current.version,max_active_projects:1});
  assert.equal((await store.listPlannerRows(db,'projects')).filter(x=>x.status==='active').length,4);
  await assert.rejects(()=>create('projects',{title:'under current cap'}),error=>error.status===409);
  await store.putPlannerSettings(db,{version:current.version,max_active_projects:null});
  await create('projects',{title:'unlimited'});
  const tasks=[];
  for (let i=0;i<2;i++) tasks.push(await create('tasks',{project_id:fourth.id,title:'task '+i,status:'doing'}));
  await assert.rejects(()=>create('tasks',{project_id:swapped.id,title:'3',status:'doing'}),error=>error.status===409&&error.details.max===2);
  const next=await create('tasks',{project_id:swapped.id,title:'3',status:'doing',resolution:{action:'replace',id:tasks[0].id}});
  await assert.rejects(()=>patch('tasks',next,{status:'blocked'}),error=>error.status===400);
  const blocked=await patch('tasks',next,{status:'blocked',blocked_reason:'fixture',check_back_on:today});
  assert.equal((await patch('tasks',blocked,{status:'next'})).unblocked_at,stamp);
});

test('Planner persists daily choices, rolls over unfinished work once, and saves completion notes and review cards', async t => {
  const { db }=localD1(t);
  const create=(kind,input)=>store.savePlannerRow(db,kind,input,undefined,now);
  const project=await create('projects',{title:'Learn',kind:'learning'});
  const first=await create('tasks',{project_id:project.id,title:'first',estimate_minutes:30});
  const second=await create('tasks',{project_id:project.id,title:'second',estimate_minutes:20});
  await flow.updatePlannerDay(db,{action:'start',available_minutes:60,focus_task_ids:[first.id,second.id]},now);
  assert.deepEqual((await flow.plannerToday(db,null,now)).day.focus_task_ids,[first.id,second.id]);
  await flow.updatePlannerDay(db,{action:'close',tasks:[{id:first.id,action:'continue'},{id:second.id,action:'blocked',blocked_reason:'waiting',check_back_on:'2026-11-20'}],note:'note'},now);
  assert.equal((await flow.plannerToday(db,null,now)).day.note,'note');
  let [a,b]=await store.listPlannerRows(db,'tasks'); assert.equal(a.rollover_count,1); assert.equal(b.status,'blocked');
  const tomorrow=new Date('2026-11-20T19:00:00Z'), later=new Date('2026-11-21T19:00:00Z');
  await flow.updatePlannerDay(db,{action:'start',focus_task_ids:[a.id]},tomorrow);
  await flow.plannerToday(db,null,later); await flow.plannerToday(db,null,later);
  [a,b]=await store.listPlannerRows(db,'tasks'); assert.equal(a.rollover_count,2); assert.equal(b.rollover_count,0);
  const done=await store.savePlannerRow(db,'tasks',{status:'done',actual_minutes:50,delay_reason:'underestimated',version:a.version,
    completion:{insight:'now I know',metric:{name:'Latency',before:10,after:5,unit:'ms'},mistake:'fix the settings',cause:'environment'}},a.id,later);
  assert(done.done_at);
  const entries=await store.listPlannerRows(db,'entries');
  assert.deepEqual(entries.map(row=>row.kind).sort(),['insight','metric','mistake']);
  const insight=entries.find(row=>row.kind==='insight');
  const card=await store.savePlannerRow(db,'cards',{entry_id:insight.id,question:'What changed?'},undefined,later);
  assert.equal(card.answer,'now I know'); assert.equal(card.due_on,'2026-11-21');
  const reviewed=await store.reviewPlannerCard(db,card.id,{result:'remembered',version:card.version},later);
  assert.equal(reviewed.interval_days,3); assert.equal(reviewed.due_on,'2026-11-24');
  assert.equal(cardReview(30,'fuzzy',new Date('2026-11-20T03:00:00Z')).due_on,'2026-12-19');
  assert.equal(cardReview(60,'forgot',now).interval_days,1);
  const report=await flow.savePlannerReview(db,{notes:{note:'weekly'},resume_entry_ids:[insight.id]},'2026-11-16',later);
  assert.equal(report.entries.find(row=>row.id===insight.id).resume_candidate,1);
  assert.equal(report.patterns.delay.underestimated,1);
  assert.equal(report.patterns.causes.environment,1);
  await store.deletePlannerRow(db,'projects',project.id,project.version);
  const kept=await store.listPlannerRows(db,'entries'); assert.equal(kept.length,3); assert(kept.every(row=>row.project_id===null&&row.task_id===null));
});

test('Interview triggers are idempotent and skill discovery creates a project with a next step', async t => {
  const { db, sqlite }=localD1(t);
  sqlite.prepare(`INSERT INTO applications(original_job_id,job_key,canonical_url,company,title,location,description,source_name,status,status_at,
    mutation_token,created_at,updated_at) VALUES(1,'fixture','https://example.com/job','Example','Engineer','NY','JD','Board','interview',?1,'match',?1,?1)`).run(stamp);
  await db.batch(flow.interviewPlannerStatements(db,1,now,'match',stamp));
  assert.equal((await flow.plannerToday(db,null,now)).pendingInterviews,1);
  const project=await store.savePlannerRow(db,'projects',{title:'求职'},undefined,now);
  await flow.fillPendingInterviews(db,now);
  await db.batch(flow.interviewPlannerStatements(db,1,now,'match',stamp));
  const {tasks,milestones}=await store.readPlannerState(db);
  assert.equal(milestones.length,1); assert.equal(tasks.length,3);
  assert.equal(tasks[0].source_ref,'application:1:interview');
  assert(tasks.every(row=>row.project_id===project.id&&row.due_on===today));
  const learning=await flow.createSkillProject(db,'Kubernetes',now);
  assert.equal((await flow.createSkillProject(db,'Kubernetes',now)).id,learning.id);
  assert.equal((await store.listPlannerRows(db,'tasks',new URLSearchParams({project:String(learning.id)}))).length,1);
});

test('Planner AI returns drafts, charges the shared budget and sends only aggregates for patterns', async t => {
  const { db, sqlite } = localD1(t);
  const original = Module._load;
  let ai;
  try {
    Module._load = function(specifier, ...args) {
      if (specifier === 'cloudflare:workers') return { env: { DEEPSEEK_API_KEY:'fixture-only', DEEPSEEK_MODEL:'fixture-model' } };
      return original.call(this, specifier, ...args);
    };
    ai=loadLocalTypeScript('lib/planner-ai.ts');
  } finally { Module._load=original; }

  const project=await store.savePlannerRow(db,'projects',{title:'Fixture project'},undefined,now);
  const outputs=[
    { tasks:[{title:'Measure latency',estimate_minutes:30},{title:'Record baseline',estimate_minutes:10},{title:'Test change',estimate_minutes:60}] },
    { kind:'insight',skills:['golang','Python3'],metric:null,cause:null },
    { suggestions:['Reserve time for estimates.','Review recurring blockers.'] },
    { tasks:[{title:'Invalid estimate',estimate_minutes:240}] },
  ];
  const inputs=[];
  t.mock.method(globalThis,'fetch',async (_url,init)=>{
    inputs.push(JSON.parse(init.body).messages.at(-1).content);
    return Response.json({choices:[{message:{content:JSON.stringify(outputs.shift())}}],
      usage:{prompt_tokens:7,completion_tokens:5,prompt_cache_hit_tokens:0}});
  });
  await store.savePlannerRow(db,'entries',{project_id:project.id,kind:'mistake',body:'PRIVATE NOTE TEXT',cause:'environment'});
  assert.equal((await ai.plannerAiDraft(db,{action:'breakdown',project_id:project.id})).tasks.length,3);
  assert.deepEqual((await ai.plannerAiDraft(db,{action:'classify',body:'Go and Python'})).skills,['Go','Python']);
  assert.equal((await ai.plannerAiDraft(db,{action:'patterns'})).suggestions.length,2);
  assert.deepEqual(Object.keys(JSON.parse(inputs[2])).sort(),['causes','delay','median','sampleSize']);
  assert(!inputs[2].includes('PRIVATE NOTE TEXT'));
  await assert.rejects(()=>ai.plannerAiDraft(db,{action:'breakdown',project_id:project.id}),error=>error.status===502);
  assert.equal(inputs.length,4);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage').get().n,4);
  assert.equal(sqlite.prepare('SELECT used FROM ai_daily_budget').get().used,4);
  assert.equal((await store.listPlannerRows(db,'entries')).length,1);
  assert.equal((await store.listPlannerRows(db,'tasks')).length,0);
});
