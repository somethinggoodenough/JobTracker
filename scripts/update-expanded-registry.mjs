import { readFileSync, writeFileSync } from 'node:fs';
import targets from '../data/expanded-adapter-targets.json' with { type: 'json' };
// Merge by employer name, preserving all existing entries and their source identities.
for (const file of ['data/company-adapters.json', 'data/source-registry.json']) {
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  for (const target of targets) {
    const index = rows.findIndex(row => row.name === target.name);
    const entry = file.includes('company-adapters') ? target : { name: target.name, url: target.url, kind: 'company' };
    if (index >= 0) rows[index] = { ...rows[index], ...entry };
    else rows.push(entry);
  }
  writeFileSync(file, '[\n' + rows.map(row => '  ' + JSON.stringify(row)).join(',\n') + '\n]\n');
}
console.log(`Updated ${targets.length} targeted employers`);
