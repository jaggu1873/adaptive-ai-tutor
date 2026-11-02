# Adaptive Tutor

An existing Vite + Three.js classroom with a lesson controller, local PDF teaching, browser speech, and an optional rigged teacher model. PDF teaching is deterministic and rule-based; it does not use a neural network, generative AI, an API key, or a paid inference service.

## Run locally

```powershell
npm install
npm run dev
```

No backend server or `.env` file is needed for tutor questions. Run `npm run dev`, upload a PDF, and ask a question. PDF text extraction, passage selection, teaching responses, and quiz feedback run in the browser. Questions and PDF content are not sent to an AI provider. `.env.example` only documents the optional teacher-model asset URL; it does not contain AI provider settings.

## Optional licensed teacher model

The procedural character remains the default fallback. To try a compatible rigged GLB:

1. Obtain a model whose license permits your intended use. Keep its license and attribution with the project.
2. Put the model in the project's public assets directory or provide a URL you control.
3. Set `VITE_TEACHER_MODEL_URL` in the frontend environment before starting Vite.

Three.js loads the model only when that variable is configured. The procedural teacher stays available if loading fails. Animation clips whose names include `idle`, `speak`/`talk`/`explain`, `listen`, `greet`/`wave`, `point`/`present`, or `think` are selected when present. Missing clips are tolerated. Commonly named mouth/jaw and blink morph targets or jaw bones are animated when present; mouth motion is still approximate and based on browser speech word-boundary events, not phoneme-level alignment. No character asset is included or downloaded by this project.

## Lessons, PDF, voice, and progress

- The sample neural-network lessons teach in three spoken steps, with explicit start, pause/resume, stop, repeat, and next-step controls. A text question interrupts the speech sequence and offers to resume from the saved step.
- Browser speech is behind a replaceable `BrowserSpeechProvider` interface. Voice availability and quality depend on the OS/browser. Choose an installed English voice and adjust speech pace. This is not a hosted neural voice service.
- PDF page rendering and text extraction run in the browser. Extracted page numbers and the uploaded filename are retained. Rule-based analysis identifies simple headings, definitions, numbered steps, formulas, examples, and frequent terms, then selects passages using transparent word matching. The teacher presents extracted facts, clearly labels its study example, and links back to source pages. It does not invent outside subject facts or verify citations. Scanned/image-only pages cannot be read; OCR and diagram/image understanding are not implemented.
- PDF questions receive deterministic, extractive teaching templates and typed quizzes. Quiz scoring compares answer keywords against source text and is approximate; it is not generative AI, a neural network, or genuine adaptive mastery modeling. The progress panel reports local study/attempt history and observed accuracy only.
- This local mode replaces the previous provider-backed tutor route. It does not make OpenAI, Gemini, local-LLM, or other AI inference calls and needs no API key. The optional `VITE_TEACHER_MODEL_URL` only loads a separately hosted/licensed visual character asset if configured.
- Browser text-to-speech quality and voice availability depend on the installed browser/OS. Speech synthesis remains local to the browser.
- Quiz attempts, concepts studied, hint usage, and lesson/step position are stored in browser local storage. This is device-local prototype progress, not an account-synced record.
- `StudentKnowledgeModel` defines a separate prediction interface but deliberately returns “not configured” until a real trained model is supplied. No neural model has been trained, evaluated, or claimed here.

## Validation

```powershell
npm test
npm run build
```

The human character is still procedural unless a properly licensed rigged model is configured. Voice quality depends on the local browser. Rule-based text matching can miss paraphrases and may not find useful passages in unusual PDF layouts. PDF visual interpretation, OCR, generative-AI teaching, an evaluated student mastery model, user accounts, and hosted realistic avatar/voice services are not included.
