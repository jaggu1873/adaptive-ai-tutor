export class TeachingController {
  constructor({ speak, stopSpeech, pauseSpeech, resumeSpeech, showBoard, playGesture = () => {}, onState = () => {} }) {
    this.speak = speak;
    this.stopSpeech = stopSpeech;
    this.pauseSpeech = pauseSpeech;
    this.resumeSpeech = resumeSpeech;
    this.showBoard = showBoard;
    this.playGesture = playGesture;
    this.onState = onState;
    this.lesson = null;
    this.lessonIndex = -1;
    this.stepIndex = 0;
    this.interrupted = false;
    this.runId = 0;
    this.state = 'idle';
  }

  start(lesson, lessonIndex, stepIndex = 0) {
    if (!lesson || !Array.isArray(lesson.steps) || lesson.steps.length === 0) {
      throw new Error('A lesson must contain at least one teaching step.');
    }
    if (this.lesson || this.state !== 'idle') this.stop();
    this.lesson = lesson;
    this.lessonIndex = lessonIndex;
    this.stepIndex = Math.max(0, Math.min(stepIndex, lesson.steps.length - 1));
    this.interrupted = false;
    this.presentStep();
  }

  presentStep() {
    if (!this.lesson || this.stepIndex >= this.lesson.steps.length) {
      if (this.lesson) this.stepIndex = this.lesson.steps.length - 1;
      this.state = 'complete';
      this.onState(this.state, this.lesson, this.stepIndex);
      return;
    }
    const runId = ++this.runId;
    const step = this.lesson.steps[this.stepIndex];
    this.state = 'speaking';
    this.onState(this.state, this.lesson, this.stepIndex);
    if (step.gesture) this.playGesture(step.gesture);
    this.showBoard(this.lesson.board, step);
    this.speak(step.speech, {
      onComplete: () => {
        if (runId !== this.runId || this.interrupted) return;
        if (step.question) {
          this.state = 'waiting';
          this.onState(this.state, this.lesson, this.stepIndex);
          return;
        }
        this.stepIndex += 1;
        this.presentStep();
      },
      onError: () => {
        if (runId !== this.runId) return;
        this.state = 'error';
        this.onState(this.state, this.lesson, this.stepIndex);
      },
    });
  }

  pause() {
    if (this.state !== 'speaking') return;
    this.pauseSpeech();
    this.state = 'paused';
    this.onState(this.state, this.lesson, this.stepIndex);
  }

  resume() {
    if (!this.lesson) return;
    if (this.state === 'paused') {
      this.resumeSpeech();
      this.state = 'speaking';
      this.onState(this.state, this.lesson, this.stepIndex);
      return;
    }
    if (this.state === 'waiting') {
      this.stepIndex += 1;
      this.presentStep();
      return;
    }
    if (this.state === 'interrupted' || this.state === 'idle' || this.state === 'stopped') {
      this.interrupted = false;
      this.presentStep();
    }
  }

  stop() {
    this.runId += 1;
    this.stopSpeech();
    this.interrupted = false;
    if (this.lesson) this.state = 'stopped';
    this.onState(this.state, this.lesson, this.stepIndex);
  }

  interrupt() {
    if (!this.lesson || this.state === 'complete') return;
    this.interrupted = true;
    this.runId += 1;
    this.stopSpeech();
    this.state = 'interrupted';
    this.onState(this.state, this.lesson, this.stepIndex);
  }

  nextStep() {
    if (!this.lesson) return;
    this.runId += 1;
    this.stopSpeech();
    this.interrupted = false;
    this.stepIndex = Math.min(this.stepIndex + 1, this.lesson.steps.length);
    this.presentStep();
  }

  repeatStep() {
    if (!this.lesson) return;
    this.runId += 1;
    this.stopSpeech();
    this.interrupted = false;
    this.presentStep();
  }
}
