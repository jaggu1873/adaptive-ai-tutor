import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSpeechProvider } from '../src/voice-provider.js';

class FakeUtterance {
  constructor(text) { this.text = text; }
}

function fakeSynthesis() {
  return {
    speaking: false,
    paused: false,
    queued: [],
    cancelCount: 0,
    speak(utterance) { this.queued.push(utterance); this.speaking = true; },
    cancel() { this.cancelCount += 1; this.speaking = false; this.paused = false; },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    getVoices() { return [{ name: 'Test voice', lang: 'en-US' }]; },
  };
}

test('speech provider cancels the previous utterance and forwards word boundaries', () => {
  const synthesis = fakeSynthesis();
  const provider = new BrowserSpeechProvider({ synthesis, Utterance: FakeUtterance });
  let words = 0;
  provider.speak('first', { onBoundary: () => { words += 1; } });
  const oldUtterance = synthesis.queued[0];
  provider.speak('second', { onBoundary: () => { words += 1; } });
  oldUtterance.onboundary({ name: 'word' });
  synthesis.queued[1].onboundary({ name: 'word' });
  assert.equal(synthesis.cancelCount, 2);
  assert.equal(words, 1);
  assert.equal(provider.voices()[0].name, 'Test voice');
});

test('speech provider exposes pause, resume, and unsupported environments', () => {
  const synthesis = fakeSynthesis();
  const provider = new BrowserSpeechProvider({ synthesis, Utterance: FakeUtterance });
  provider.speak('lesson');
  provider.pause();
  assert.equal(provider.paused, true);
  provider.resume();
  assert.equal(provider.paused, false);
  provider.stop();
  assert.equal(provider.speaking, false);
  assert.equal(new BrowserSpeechProvider({ synthesis: null, Utterance: null }).supported, false);
});

test('speech provider reports synchronous playback errors', async () => {
  const synthesis = fakeSynthesis();
  synthesis.speak = () => { throw new Error('audio unavailable'); };
  const provider = new BrowserSpeechProvider({ synthesis, Utterance: FakeUtterance });
  let playbackError;
  const utterance = provider.speak('lesson', { onError: error => { playbackError = error.message; } });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(provider.current, null);
  assert.equal(utterance.text, 'lesson');
  assert.equal(playbackError, 'audio unavailable');
});
