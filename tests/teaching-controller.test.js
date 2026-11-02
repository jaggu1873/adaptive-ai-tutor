import test from 'node:test';
import assert from 'node:assert/strict';
import { TeachingController } from '../src/teaching-controller.js';

function setup() {
  const events = [];
  let callbacks;
  const controller = new TeachingController({
    speak: (text, handlers) => { callbacks = handlers; events.push(['speak', text]); },
    stopSpeech: () => events.push(['stop']),
    showBoard: (_board, step) => events.push(['board', step.reveal]),
    onState: (state, _lesson, index) => events.push(['state', state, index]),
  });
  return { controller, events, complete: () => callbacks.onComplete() };
}

const lesson = { board: {}, steps: [{ speech: 'first', reveal: 1 }, { speech: 'second', reveal: 2 }] };

test('teaching sequence presents each board step before completing', () => {
  const { controller, events, complete } = setup();
  controller.start(lesson, 0);
  assert.deepEqual(events.slice(0, 3), [['state', 'speaking', 0], ['board', 1], ['speak', 'first']]);
  complete();
  assert.deepEqual(events.slice(3, 6), [['state', 'speaking', 1], ['board', 2], ['speak', 'second']]);
  complete();
  assert.equal(controller.state, 'complete');
});

test('interrupt invalidates speech completion and resumes the same step', () => {
  const { controller, events, complete } = setup();
  controller.start(lesson, 0);
  const lateComplete = complete;
  controller.interrupt();
  lateComplete();
  assert.equal(controller.stepIndex, 0);
  assert.equal(controller.state, 'interrupted');
  controller.resume();
  assert.equal(events.at(-1)[0], 'speak');
  assert.equal(events.at(-1)[1], 'first');
});

test('stop prevents a queued completion from advancing the lesson', () => {
  const { controller, complete } = setup();
  controller.start(lesson, 0);
  const lateComplete = complete;
  controller.stop();
  lateComplete();
  assert.equal(controller.state, 'stopped');
  assert.equal(controller.stepIndex, 0);
});

test('a step with a comprehension question waits instead of auto-advancing', () => {
  const { controller, complete } = setup();
  controller.start({ board: {}, steps: [{ speech: 'check', reveal: 1, question: 'What did we learn?' }, lesson.steps[1]] }, 0);
  complete();
  assert.equal(controller.state, 'waiting');
  assert.equal(controller.stepIndex, 0);
  controller.resume();
  assert.equal(controller.stepIndex, 1);
});
