import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { loadLocalTypeScript } from '../scripts/load-local-typescript.mjs';

const { applicationAnalytics, buildAnalyticsItem, GHOST_DAYS } = loadLocalTypeScript('lib/application-analytics.ts');
const { kpis, weekly, funnel, skillGaps, groupRows, linkedItems, timeRange } = loadLocalTypeScript('lib/application-analytics-view.ts');
const { normalizeTechnologies } = loadLocalTypeScript('lib/tech-aliases.ts');
const now = new Date('2026-11-18T12:00:00Z');
const days = (ago = 0, offsetMs = 0) => new Date(now.getTime() - ago * 86400000 + offsetMs).toISOString();
const snapshot = (version = 1, tech_stack = ['Go', 'Python', 'Redis']) => JSON.stringify({
 id: 1, name: 'Backend', target_role: 'Backend', created_at: days(90), version, tech_stack, pdf_name: null, selected_at: days(80),
});
const analysis = ({ tech = ['golang', 'PYTHON3', 'Python', 'cpp'], countries = ['US', 'CN'] } = {}) => JSON.stringify({
 accepted: true, countries, categories: ['backend_distributed', 'cloud_platform'], careerLevel: 'junior',
 techStack: tech.map(name => ({name})),
});
const row = (fields = {}) => ({
 id: 1, company: 'Example', title: 'Engineer', status: 'applied', applied_at: days(10), created_at: days(80),
 location: 'China', description: 'Example JD', resume_snapshot: null, ai_analysis: null, first_seen_at: null, events: [], ...fields,
});
const item = fields => buildAnalyticsItem(row(fields), now);

test('analytics assigns one outcome by furthest stage and distinguishes the 21-day boundary', () => {
 const outcomes = [
  [{ status: 'accepted', events: [['screening', days(9)], ['interview', days(5)]] }, 'offer'],
  [{ status: 'rejected', events: [['interview', days(4)], ['screening', days(8)], ['rejected', days(3)]] }, 'interview'],
  [{ status: 'screening' }, 'screening'],
  [{ status: 'rejected' }, 'rejected'],
  [{ status: 'withdrawn' }, 'withdrawn'],
  [{ applied_at: days(GHOST_DAYS, 1) }, 'waiting'],
  [{ applied_at: days(GHOST_DAYS) }, 'ghosted'],
 ];
 assert.equal(GHOST_DAYS, 21);
 for (const [fields, expected] of outcomes) assert.equal(item(fields).outcome, expected);
 const progression = item(outcomes[1][0]);
 assert.equal(progression.rejectedAfterProgress, true);
 assert.equal(progression.firstResponseDays, 2);
 assert.equal(item({ status: 'screening' }).firstResponseDays, null);
 assert.equal(item({ status: 'withdrawn', events: [['rejected', days(5)]] }).outcome, 'rejected');
 assert.equal(item({ status: 'saved', applied_at: null, events: [['saved', days(3)]] }), null);
 assert.equal(item({ status: 'withdrawn', applied_at: null }), null);
});

test('analytics resolves applied time through explicit, first applied event, other event and created time', () => {
 const events = [['saved', days(20)], ['applied', days(9)], ['applied', days(12)]];
 assert.equal(item({ applied_at: days(7), events }).appliedAt, days(7));
 assert.equal(item({ applied_at: null, events }).appliedAt, days(12));
 assert.equal(item({ applied_at: null, status: 'interview', events: [['interview', days(5)], ['saved', days(20)]] }).appliedAt, days(20));
 assert.equal(item({ applied_at: null, created_at: days(30) }).appliedAt, days(30));
});

test('analytics normalizes both skill lists, covers missing-data cases and scopes sponsorship to US locations', () => {
 const detail = item({ ai_analysis: analysis(), resume_snapshot: snapshot(2), description: 'We offer H-1B visa sponsorship for this position.', location: 'United States' });
 assert.equal(detail.coverage, 2 / 3);
 assert.deepEqual(detail.jdSkills, ['Go', 'Python', 'C++']);
 assert.deepEqual(detail.matchedSkills, ['Go', 'Python']);
 assert.deepEqual(detail.missingSkills, ['C++']);
 assert.deepEqual(detail.resume, { id: 1, name: 'Backend', version: 2 });
 assert.equal(detail.visa, 'available');
 assert.equal(item({ ai_analysis: analysis() }).coverage, null);
 assert.equal(item({ ai_analysis: analysis({ tech: [] }), resume_snapshot: snapshot() }).coverage, null);
 assert.equal(item({ ai_analysis: analysis(), resume_snapshot: snapshot(1, []) }).coverage, 0);
 assert.equal(item({ ai_analysis: analysis({ countries: ['CN'] }) }).visa, null);
 assert.equal(item({ location: 'California, USA', description: 'We cannot provide visa sponsorship.' }).visa, 'unavailable');
 assert.equal(item({ location: 'California, USA' }).visa, 'unclear');
 assert.deepEqual(normalizeTechnologies([' ＧＯＬＡＮＧ ', ' Go ', 'k8s', 'JS', 'TS', 'postgres', 'py', 'c  plus plus',
  'NodeJS', 'react.js', 'Amazon Web Services', 'Google Cloud', 'torch', 'tf']), [
  'Go', 'Kubernetes', 'JavaScript', 'TypeScript', 'PostgreSQL', 'Python', 'C++', 'Node.js', 'React', 'AWS', 'GCP', 'PyTorch', 'TensorFlow',
 ]);
});

test('analytics joins job discovery first, falls back to live jobs, and returns only submitted details', async () => {
 const sqlite = new DatabaseSync(':memory:');
 try {
  for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
   sqlite.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
  }
  const db = { prepare(sql) { return { async all() { return { results: sqlite.prepare(sql).all() }; } }; } };
  sqlite.exec("INSERT INTO sources(id,name,url) VALUES(1,'Example','https://example.test')");
  const job = sqlite.prepare(`INSERT INTO jobs(source_id,source_external_key,dedupe_key,canonical_url,company,title,posted_at,first_seen_at,last_seen_at,updated_at)
   VALUES(1,?1,?1,?2,'Example','Engineer',?3,?3,?3,?3)`);
  const insert = sqlite.prepare(`INSERT INTO applications(id,original_job_id,job_key,canonical_url,company,title,location,description,
   source_name,status,applied_at,resume_snapshot,ai_analysis,status_at,created_at,updated_at,mutation_token)
   VALUES(?1,?1,?2,?3,'Example','Engineer','United States','Example JD','Example',?4,?5,?6,?7,?8,?8,?8,?2)`);
  for (let id = 1; id <= 5; id++) {
   const key = 'ref-' + id, url = 'https://example.test/' + id;
   insert.run(id, key, url, id >= 4 ? 'saved' : 'applied', id === 1 ? days(10) : null, snapshot(id), analysis(), days(14));
   if (id <= 2) job.run(key, url, days(16));
  }
  sqlite.prepare('INSERT INTO job_discoveries(identity,first_seen_at) VALUES(?,?)').run('fingerprint:ref-1', days(17));
  const event = sqlite.prepare('INSERT INTO application_events(application_id,status,reached_at,recorded_at) VALUES(?,?,?,?)');
  event.run(1, 'interview', days(3), days(3)); event.run(1, 'rejected', days(1), days(1)); event.run(1, 'screening', days(6), days(6));
  event.run(2, 'applied', days(11), days(11)); event.run(4, 'applied', days(12), days(12));
  const result = await applicationAnalytics(db, now);
  const byId = new Map(result.items.map(value => [value.id, value]));
  assert.deepEqual(Object.keys(result).sort(), ['generatedAt', 'ghostDays', 'items', 'tracked']);
  assert.equal(result.tracked, 5);
  assert.equal(result.generatedAt, now.toISOString());
  assert.deepEqual([...byId.keys()].sort(), [1,2,3,4]);
  assert.equal(byId.get(1).applyLagDays, 7);
  assert.equal(byId.get(2).applyLagDays, 5);
  assert.equal(byId.get(3).applyLagDays, null);
  assert.equal(byId.get(1).outcome, 'interview');
  assert.equal(byId.get(1).rejectedAfterProgress, true);
  assert.equal(byId.get(1).firstResponseDays, 4);
  assert.equal(byId.get(4).appliedAt, days(12));
 } finally { sqlite.close(); }
});

test('KPI and funnel count replies consistently and exclude waiting and withdrawn from response rates', () => {
 const applications = ['offer', 'interview', 'screening', 'rejected', 'ghosted', 'waiting', 'withdrawn'].map((outcome, id) => ({
  ...item({ id }), outcome, firstResponseDays: id < 4 ? id : null,
 }));
 assert.deepEqual(kpis(applications), {
  submitted: 7, replied: 4, mature: 5, responseRate: 0.8, waiting: 1, withdrawn: 1, interviewed: 2, medianResponse: 1.5,
 });
 assert.deepEqual(funnel(applications).map(row => row.amount), [7,4,3,2,1]);
 assert.equal(kpis(applications.slice(-2)).responseRate, null);
});

test('weekly uses New York Monday boundaries and limits the chart to the last 12 weeks', () => {
 const applications = [
  item({ id: 1, applied_at: '2026-11-16T04:59:59Z' }),
  item({ id: 2, applied_at: '2026-11-16T05:00:00Z' }),
  item({ id: 3, applied_at: days(100) }),
 ];
 const weeks = weekly(applications, now);
 assert.equal(weeks.length, 12);
 assert.equal(weeks.at(-2).week, '2026-11-09');
 assert.deepEqual(weeks.at(-2).items.map(item => item.id), [1]);
 assert.equal(weeks.at(-1).week, '2026-11-16');
 assert.deepEqual(weeks.at(-1).items.map(item => item.id), [2]);
 assert.deepEqual(timeRange(applications, '90', now).map(item => item.id), [1,2]);
 assert.deepEqual(timeRange([item({ applied_at: days(30) }), item({ applied_at: days(30, -1) })], '30', now).map(item => item.appliedAt), [days(30)]);
});

test('skill gaps rank counts, split matched and missing, and group comparisons retain multi-label and unknown entries', () => {
 const applications = [
  item({ id: 1, ai_analysis: analysis({ tech: ['Go', 'k8s'] }), resume_snapshot: snapshot(1), first_seen_at: days(17) }),
  item({ id: 2, ai_analysis: analysis({ tech: ['GO', 'golang', 'Python'], countries: ['US'] }), resume_snapshot: snapshot(2, ['py']), first_seen_at: days(11) }),
  item({ id: 3, location: 'Remote', first_seen_at: days(8) }),
  item({ id: 4, location: 'Remote' }),
 ];
 const gaps = skillGaps(applications);
 assert.deepEqual(gaps.map(group => [group.skill, group.included.length, group.missing.length, group.total]), [
  ['Go', 1, 1, 2], ['Kubernetes', 0, 1, 1], ['Python', 1, 0, 1],
 ]);
 assert.deepEqual(skillGaps(applications, 1).map(group => group.skill), ['Go']);
 assert.deepEqual(groupRows(applications, 'country').map(group => [group.key, group.items.length]), [['US', 2], ['CN', 1], ['', 2]]);
 assert.deepEqual(groupRows(applications, 'resume').map(group => group.label), ['Backend v1', 'Backend v2', '未知']);
 assert.deepEqual(groupRows(applications, 'lag').map(group => group.label), ['0–3 天', '4–7 天', '未知']);
 assert.equal(groupRows(applications, 'role').find(group => group.key === 'backend_distributed').items.length, 2);
 assert.equal(groupRows(applications, 'role').find(group => group.key === 'cloud_platform').items.length, 2);
 assert.deepEqual(linkedItems(applications, { kind: 'skill', skill: 'Go' }).map(item => item.id), [1,2]);
 assert.deepEqual(linkedItems(applications, { kind: 'group', dimension: 'resume', key: '1:2' }).map(item => item.id), [2]);
 assert.deepEqual(linkedItems(applications, { kind: 'application', id: 3 }).map(item => item.id), [3]);
});
