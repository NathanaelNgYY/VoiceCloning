import { evidenceFromEvent } from '../lambda/analytics/concepts.js';
import { createLearnerStore } from '../lambda/analytics/learnerStore.js';
import { createAnalyticsEventRepository } from '../lambda/learners/eventRepository.js';
import { listObjects } from '../lambda/shared/s3.js';

const apply = process.argv.includes('--apply');
const tableName = process.env.LEARNER_TABLE_NAME || '';
if (apply && !tableName) throw new Error('LEARNER_TABLE_NAME is required with --apply');

const objects = await listObjects('analytics/users/');
const oids = [...new Set(objects.map((object) => (
  /^analytics\/users\/([^/]+)\//u.exec(object.key)?.[1] || ''
)).filter((oid) => /^[A-Za-z0-9-]+$/u.test(oid)))].sort();

const repository = createAnalyticsEventRepository();
const store = apply ? createLearnerStore({ tableName }) : null;
const users = [];

for (const oid of oids) {
  const result = await repository.getUserEvents(oid);
  const qualifying = result.events.map((event) => ({ event, evidence: evidenceFromEvent(event) }))
    .filter((entry) => entry.evidence);
  const byConcept = {};
  for (const { evidence } of qualifying) {
    const key = `${evidence.concept.id}:${evidence.signal}`;
    byConcept[key] = (byConcept[key] || 0) + 1;
  }
  const applied = apply
    ? await store.recordBatch({ oid, synthetic: false }, result.events)
    : null;
  users.push({
    oid,
    rawEvents: result.events.length,
    qualifyingEvents: qualifying.length,
    byConcept,
    truncated: result.truncated,
    writtenConcepts: applied?.recorded || 0,
  });
}

process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', users }, null, 2)}\n`);
