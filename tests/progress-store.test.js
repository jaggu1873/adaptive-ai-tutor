import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress, estimateMasteryFromHistory, loadProgress, recordAttempt, recordHintUse, saveProgress } from '../src/progress-store.js';

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
  };
}

test('progress persists attempts, study history, and lesson position', () => {
  const storage = memoryStorage();
  let progress = { ...emptyProgress(), lessonIndex: 1, stepIndex: 2 };
  progress = recordAttempt(progress, 1, true, false);
  saveProgress(progress, storage);
  const restored = loadProgress(storage);
  assert.equal(restored.lessonIndex, 1);
  assert.equal(restored.stepIndex, 2);
  assert.deepEqual(restored.studied, [1]);
  assert.deepEqual(estimateMasteryFromHistory(restored, 1), { available: true, attempts: 1, accuracy: 1 });
});

test('malformed persisted JSON returns a safe empty progress record', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(loadProgress(memoryStorage('{')), emptyProgress());
  } finally {
    console.warn = originalWarn;
  }
});

test('progress migration keeps prior quiz attempts and counts hints', () => {
  const storage = memoryStorage(JSON.stringify([{ lesson: 2, correct: false, at: '2026-01-01' }]));
  storage.getItem = key => key === 'tutorQuizHistory' ? JSON.stringify([{ lesson: 2, correct: false, at: '2026-01-01' }]) : null;
  const migrated = loadProgress(storage);
  assert.equal(migrated.attempts[0].lessonIndex, 2);
  const withHint = recordHintUse(migrated);
  assert.equal(withHint.hintUses, 1);
  const afterAttempt = recordAttempt(withHint, 2, true, withHint.hintsSinceAttempt > 0);
  assert.equal(afterAttempt.attempts.at(-1).usedHint, true);
  assert.equal(afterAttempt.hintsSinceAttempt, 0);
});
