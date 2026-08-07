import assert from 'node:assert/strict';
import test from 'node:test';

import { createLearnerRepository } from './repository.js';

test('resetting the only concept deletes both concept and empty lesson summary', async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command);
      if (command.constructor.name === 'QueryCommand') return { Items: [] };
      return {};
    },
  };
  const repository = createLearnerRepository({ tableName: 'learners', client });
  const result = await repository.resetConcept('user-1', 'gi-bleeding', 'endoscopy');
  assert.deepEqual(result, { reset: true, summary: null });
  assert.equal(commands[0].constructor.name, 'DeleteCommand');
  assert.deepEqual(commands[0].input.Key, {
    PK: 'USER#user-1',
    SK: 'LESSON#gi-bleeding#CONCEPT#endoscopy',
  });
  assert.equal(commands.at(-1).constructor.name, 'DeleteCommand');
  assert.equal(commands.at(-1).input.Key.SK, 'LESSON#gi-bleeding#SUMMARY');
});

test('resetting one concept rebuilds the summary from remaining concepts', async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command);
      if (command.constructor.name === 'QueryCommand') {
        return { Items: [{
          conceptId: 'risk',
          conceptLabel: 'Risk stratification',
          evidenceScore: 2,
          evidenceCount: 2,
          signals: new Set(['repeated_question']),
          updatedAt: '2026-08-07T11:00:00.000Z',
        }] };
      }
      return {};
    },
  };
  const repository = createLearnerRepository({
    tableName: 'learners',
    client,
    now: () => new Date('2026-08-07T12:00:00.000Z'),
  });
  const result = await repository.resetConcept('user-1', 'gi-bleeding', 'endoscopy');
  assert.equal(result.summary.focusConcepts[0], 'risk');
  const put = commands.find((command) => command.constructor.name === 'PutCommand');
  assert.equal(put.input.Item.source, 'rules');
  assert.equal(put.input.Item.concepts[0].status, 'support_recommended');
});

test('learner summary reads drop evidence after the rolling window without a new write', async () => {
  const client = {
    async send(command) {
      assert.equal(command.constructor.name, 'QueryCommand');
      return { Items: [{
        conceptId: 'endoscopy',
        conceptLabel: 'Endoscopy timing and therapy',
        evidenceScore: 5,
        evidenceCount: 4,
        signals: new Set(['rewatched_segment']),
        updatedAt: '2026-06-01T00:00:00.000Z',
      }] };
    },
  };
  const repository = createLearnerRepository({
    tableName: 'learners',
    client,
    now: () => new Date('2026-08-07T12:00:00.000Z'),
  });
  const summary = await repository.getSummary('user-1', 'gi-bleeding');
  assert.equal(summary.concepts[0].evidenceScore, 0);
  assert.deepEqual(summary.focusConcepts, []);
  assert.match(summary.summary, /no recent behaviour signals/i);
});

test('concept cohort ranks by distinct learners at the maximum support threshold', async () => {
  const occurredAt = '2026-08-07T11:00:00.000Z';
  const conceptItem = (oid, conceptId, conceptLabel, events) => ({
    PK: `USER#${oid}`,
    SK: `LESSON#gi-bleeding#CONCEPT#${conceptId}`,
    conceptId,
    conceptLabel,
    evidenceEvents: events.map(([signal, weight], index) => ({
      eventId: `${oid}-${conceptId}-${index}`,
      signal,
      weight,
      occurredAt,
    })),
    updatedAt: occurredAt,
  });
  const client = {
    async send(command) {
      if (command.input.IndexName === 'GSI1') {
        return { Items: ['one', 'two', 'three'].map((oid) => ({ PK: `USER#${oid}` })) };
      }
      if (command.input.ExpressionAttributeValues?.[':pk'] === 'USER#one') {
        return { Items: [
          conceptItem('one', 'endoscopy', 'Endoscopy timing and therapy', [
            ['rewatched_segment', 0.5], ['rewatched_segment', 0.5],
            ['repeated_question', 1], ['repeated_question', 1],
          ]),
          conceptItem('one', 'investigations-risk-stratification', 'Investigations and risk stratification', [
            ['rewatched_segment', 0.5], ['rewatched_segment', 0.5],
            ['repeated_question', 1], ['repeated_question', 1],
          ]),
        ] };
      }
      if (command.input.ExpressionAttributeValues?.[':pk'] === 'USER#two') {
        return { Items: [conceptItem('two', 'endoscopy', 'Endoscopy timing and therapy', [
          ['repeated_question', 1], ['repeated_question', 1],
        ])] };
      }
      return { Items: [] };
    },
  };
  const repository = createLearnerRepository({
    tableName: 'learners',
    client,
    now: () => new Date('2026-08-07T12:00:00.000Z'),
  });
  const cohort = await repository.getConceptCohort('gi-bleeding');
  assert.equal(cohort.totalLearners, 3);
  assert.equal(cohort.strongSupportThreshold, 3);
  assert.equal(cohort.concepts[0].conceptId, 'endoscopy');
  assert.equal(cohort.concepts[0].strongSupportLearners, 1);
  assert.equal(cohort.concepts[0].supportRecommendedLearners, 2);
  assert.equal(cohort.concepts[0].strongSupportPercent, 33.3);
});
