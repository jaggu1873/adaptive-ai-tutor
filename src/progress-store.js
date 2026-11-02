const STORAGE_KEY = 'adaptiveTutorProgress';

export function emptyProgress() {
  return { lessonIndex: 0, stepIndex: 0, attempts: [], studied: [], hintUses: 0, hintsSinceAttempt: 0 };
}

export function loadProgress(storage = globalThis.localStorage) {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (!value) {
      const legacy = storage.getItem('tutorQuizHistory');
      if (!legacy) return emptyProgress();
      const attempts = JSON.parse(legacy);
      if (!Array.isArray(attempts)) throw new Error('Legacy tutor progress is not a list.');
      return {
        ...emptyProgress(),
        attempts: attempts.filter(item => Number.isInteger(item.lesson) && typeof item.correct === 'boolean')
          .slice(-100)
          .map(item => ({ lessonIndex: item.lesson, correct: item.correct, usedHint: false, at: item.at })),
      };
    }
    const parsed = JSON.parse(value);
    if (!parsed || !Array.isArray(parsed.attempts) || !Array.isArray(parsed.studied)) {
      throw new Error('Saved tutor progress has an invalid shape.');
    }
    return {
      lessonIndex: Number.isInteger(parsed.lessonIndex) && parsed.lessonIndex >= 0 ? parsed.lessonIndex : 0,
      stepIndex: Number.isInteger(parsed.stepIndex) && parsed.stepIndex >= 0 ? parsed.stepIndex : 0,
      attempts: parsed.attempts.slice(-100),
      studied: [...new Set(parsed.studied.filter(Number.isInteger))],
      hintUses: Number.isInteger(parsed.hintUses) && parsed.hintUses >= 0 ? parsed.hintUses : 0,
      hintsSinceAttempt: Number.isInteger(parsed.hintsSinceAttempt) && parsed.hintsSinceAttempt >= 0 ? parsed.hintsSinceAttempt : 0,
    };
  } catch (error) {
    console.warn('Could not read saved tutor progress; starting with an empty record.', error);
    return emptyProgress();
  }
}

export function saveProgress(progress, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function recordAttempt(progress, lessonIndex, correct, usedHint = false) {
  const attempts = [...progress.attempts, { lessonIndex, correct, usedHint, at: new Date().toISOString() }].slice(-100);
  const studied = progress.studied.includes(lessonIndex) ? progress.studied : [...progress.studied, lessonIndex];
  return { ...progress, attempts, studied, hintsSinceAttempt: 0 };
}

export function recordHintUse(progress) {
  return {
    ...progress,
    hintUses: (progress.hintUses || 0) + 1,
    hintsSinceAttempt: (progress.hintsSinceAttempt || 0) + 1,
  };
}

export function estimateMasteryFromHistory(progress, lessonIndex) {
  const relevant = progress.attempts.filter(attempt => attempt.lessonIndex === lessonIndex);
  if (!relevant.length) return { available: false, attempts: 0, accuracy: null };
  return {
    available: true,
    attempts: relevant.length,
    accuracy: relevant.filter(attempt => attempt.correct).length / relevant.length,
  };
}
