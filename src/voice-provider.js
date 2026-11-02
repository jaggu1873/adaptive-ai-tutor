export class BrowserSpeechProvider {
  constructor({ synthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
    this.synthesis = synthesis;
    this.Utterance = Utterance;
    this.current = null;
  }

  get supported() {
    return Boolean(this.synthesis && this.Utterance);
  }

  get paused() {
    return Boolean(this.synthesis?.paused);
  }

  get speaking() {
    return Boolean(this.synthesis?.speaking);
  }

  voices() {
    return this.supported ? this.synthesis.getVoices() : [];
  }

  onVoicesChanged(callback) {
    this.synthesis?.addEventListener?.('voiceschanged', callback);
  }

  speak(text, { voice = null, rate = 1, pitch = 1, volume = 1, onStart, onBoundary, onEnd, onError } = {}) {
    if (!this.supported) return null;
    this.stop();
    const utterance = new this.Utterance(text);
    this.current = utterance;
    utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-US';
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;
    utterance.onstart = event => { if (this.current === utterance) onStart?.(event); };
    utterance.onboundary = event => { if (this.current === utterance) onBoundary?.(event); };
    utterance.onend = event => {
      if (this.current !== utterance) return;
      this.current = null;
      onEnd?.(event);
    };
    utterance.onerror = event => {
      if (this.current !== utterance) return;
      this.current = null;
      onError?.(event);
    };
    try {
      this.synthesis.speak(utterance);
    } catch (error) {
      queueMicrotask(() => {
        if (this.current !== utterance) return;
        this.current = null;
        onError?.(error);
      });
    }
    return utterance;
  }

  pause() {
    if (this.supported && this.synthesis.speaking && !this.synthesis.paused) this.synthesis.pause();
  }

  resume() {
    if (this.supported && this.synthesis.paused) this.synthesis.resume();
  }

  stop() {
    if (!this.supported) return;
    this.current = null;
    this.synthesis.cancel();
  }
}
