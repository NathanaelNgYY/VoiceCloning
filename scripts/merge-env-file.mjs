#!/usr/bin/env node

import fs from 'node:fs';

const [templatePath, targetPath, ...allowedKeys] = process.argv.slice(2);
if (!templatePath || !targetPath || allowedKeys.length === 0) {
  throw new Error('Usage: merge-env-file.mjs <template> <target> <allowed-key>...');
}

const allowed = new Set(allowedKeys);
const assignments = new Map();
for (const line of fs.readFileSync(templatePath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && allowed.has(match[1])) assignments.set(match[1], line);
}
for (const key of allowed) {
  if (!assignments.has(key)) throw new Error(`Template is missing required key ${key}`);
}

const source = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
const seen = new Set();
const output = source.split(/\r?\n/).map((line) => {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
  if (!match || !assignments.has(match[1])) return line;
  if (seen.has(match[1])) return null;
  seen.add(match[1]);
  return assignments.get(match[1]);
}).filter((line) => line !== null);

for (const [key, line] of assignments) {
  if (!seen.has(key)) output.push(line);
}
fs.writeFileSync(targetPath, `${output.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
