import test from 'node:test';
import assert from 'node:assert/strict';
import { StudentKnowledgeModel } from '../src/student-knowledge-model.js';

test('knowledge model reports unavailable rather than fabricating a prediction', async () => {
  const model = new StudentKnowledgeModel();
  assert.deepEqual(await model.predict({ attempts: 2 }), {
    available: false,
    reason: 'No trained student knowledge model is configured.',
  });
});

test('knowledge model validates provider probabilities', async () => {
  const model = new StudentKnowledgeModel({ predict: async () => 0.8 });
  assert.deepEqual(await model.predict({ attempts: 2 }), { available: true, probability: 0.8 });
  const invalid = new StudentKnowledgeModel({ predict: async () => 1.2 });
  await assert.rejects(invalid.predict({}), /probability from 0 to 1/);
});
