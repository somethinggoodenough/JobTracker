import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { loadLocalTypeScript } from '../scripts/load-local-typescript.mjs';

const { applicationAnalytics } = loadLocalTypeScript('lib/application-analytics.ts');
test('Analytics counts each submitted application once and preserves both progression and rejection', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
    }
    const db = { prepare(sql) { return { async all() { return { results: sqlite.prepare(sql).all() }; } }; } };
    const stamp = '2026-11-18T14:00:00.000Z';
    const resume = version => JSON.stringify({id: 1, name: 'Backend', target_role: 'Backend', created_at: stamp, version,
      tech_stack: ['Python', 'PYTHON', 'Redis'], pdf_name: null, selected_at: stamp});
    const analysis = JSON.stringify({accepted: true, countries: ['US', 'CN'], categories: ['backend_distributed', 'cloud_platform'],
      techStack: [{ name: 'Python' }, { name: 'python' }, { name: 'C++' }]});
    const insert = sqlite.prepare(`INSERT INTO applications(id,original_job_id,job_key,canonical_url,company,title,location,description,
      source_name,status,applied_at,resume_id,resume_snapshot,ai_analysis,status_at,mutation_token,created_at,updated_at)
      VALUES(?1,?1,?2,?2,'Example','Engineer',?3,'Example JD','Example',?4,?5,?6,?7,?8,?9,?2,?9,?9)`);
    insert.run(1, 'ref-1', 'US; China', 'rejected', stamp, 1, resume(1), analysis, stamp);
    insert.run(2, 'ref-2', 'Beijing, China', 'interview', null, 1, resume(2), null, stamp);
    insert.run(3, 'ref-3', 'Remote', 'saved', null, null, null, null, stamp);
    insert.run(4, 'ref-4', 'Remote', 'withdrawn', null, null, null, null, stamp);
    insert.run(5, 'ref-5', 'Unknown', 'applied', stamp, null, null, null, stamp);
    insert.run(6, 'ref-6', 'California, USA', 'withdrawn', null, null, null, null, stamp);
    const event = sqlite.prepare('INSERT INTO application_events(application_id,status,reached_at,recorded_at) VALUES(?,?,?,?)');
    for(const stage of ['applied','screening','interview','interview','rejected']) event.run(1,stage,stamp,stamp);
    event.run(6,'applied',stamp,stamp);
    const result = await applicationAnalytics(db);
    assert.equal(result.tracked, 6);
    assert.deepEqual(result.submitted, {applied: 4, advanced: 2, rejected: 1, open: 1});
    assert.deepEqual(result.groups.resume.find(row => row.key === '1'), {key:'1',label:'Backend',applied:2,advanced:2,rejected:1,open:0});
    assert.equal(result.groups.country.find(row => row.key === 'US').applied, 2);
    assert.equal(result.groups.country.find(row => row.key === 'CN').applied, 2);
    assert.equal(result.groups.role.find(row => row.key === 'cloud_platform').rejected, 1);
    assert.equal(result.groups.jobStack.find(row => row.key === 'python').applied, 1);
    assert.equal(result.groups.resumeStack.find(row => row.key === 'python').applied, 2);
  } finally { sqlite.close(); }
});
