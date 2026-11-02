import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePdf,
  evaluateQuizAnswer,
  extractPdfPageTexts,
  generateTeachingResponse,
  makeDocumentQuiz,
  selectRelevantPassages,
} from '../src/pdf-teaching-engine.js';

function sourcePages() {
  return [{
    page: 2,
    text: [
      'PHOTOSYNTHESIS',
      'Photosynthesis is the process plants use to convert light energy into chemical energy.',
      'Step 1: Chlorophyll captures light energy.',
      'The formula is glucose + oxygen = carbon dioxide + water.',
      'For example, a leaf uses light during this process.',
    ].join('\n'),
  }, {
    page: 5,
    text: 'Plants store chemical energy in glucose. This stored energy can support growth.',
  }];
}

test('PDF text extraction preserves actual one-based page numbers and line breaks', async () => {
  const fakeDocument = {
    numPages: 2,
    async getPage(pageNumber) {
      return {
        async getTextContent() {
          return {
            items: pageNumber === 1
              ? [
                { str: 'FIRST HEADING', transform: [1, 0, 0, 1, 10, 700] },
                { str: 'First line.', transform: [1, 0, 0, 1, 10, 680] },
                { str: 'Second line.', transform: [1, 0, 0, 1, 10, 660] },
              ]
              : [{ str: 'Page two text.', hasEOL: true }, { str: 'Another sentence.' }],
          };
        },
      };
    },
  };
  assert.deepEqual(await extractPdfPageTexts(fakeDocument), [
    { page: 1, text: 'FIRST HEADING\nFirst line.\nSecond line.' },
    { page: 2, text: 'Page two text.\nAnother sentence.' },
  ]);
});

test('PDF analysis identifies headings, definitions, numbered steps, formulas, examples, and keywords', () => {
  const document = analyzePdf(sourcePages(), 'biology-notes.pdf');
  assert.equal(document.sections[0].title, 'PHOTOSYNTHESIS');
  assert.equal(document.paragraphs.find((item) => item.text.startsWith('Photosynthesis')).kind, 'definition');
  assert.equal(document.paragraphs.find((item) => item.text.startsWith('Step 1')).kind, 'numbered-step');
  assert.equal(document.paragraphs.find((item) => item.text.startsWith('The formula')).kind, 'formula');
  assert.equal(document.paragraphs.find((item) => item.text.startsWith('For example')).kind, 'example');
  assert.ok(document.keywords.includes('photosynthesis'));
});

test('relevant passage retrieval ranks matches and retains source page metadata', () => {
  const document = analyzePdf(sourcePages(), 'biology-notes.pdf');
  const matches = selectRelevantPassages(document, 'How does chlorophyll capture light energy?');
  assert.ok(matches.length > 0);
  assert.equal(matches[0].page, 2);
  assert.equal(matches[0].kind, 'numbered-step');
  assert.ok(matches[0].matchedTerms.includes('chlorophyll'));
});

test('rule-based answer includes explanation, key terms, example label, summary, memory aid, and page sources', () => {
  const response = generateTeachingResponse({
    pages: sourcePages(),
    fileName: 'biology-notes.pdf',
    question: 'What does photosynthesis do?',
  });
  assert.equal(response.available, true);
  assert.match(response.answer, /Rule-based teaching from biology-notes\.pdf/);
  assert.match(response.explanation, /page 2/);
  assert.ok(response.keyTerms.some((item) => item.term === 'photosynthesis' && item.page === 2));
  assert.match(response.example, /Illustrative example, not from the PDF/);
  assert.ok(response.summary.length > 0);
  assert.ok(response.memoryAid.length > 0);
  assert.deepEqual(response.sourceReferences, [{ fileName: 'biology-notes.pdf', page: 2 }]);
  assert.ok(response.steps.every((step) => Number.isInteger(step.page)));
});

test('quiz questions, answers, and feedback are derived from extracted source text', () => {
  const quiz = makeDocumentQuiz(sourcePages(), 'biology-notes.pdf');
  assert.equal(quiz.length, 3);
  assert.ok(quiz.every((item) => item.prompt.includes('biology-notes.pdf')));
  assert.ok(quiz.every((item) => item.answer.includes('Photosynthesis') || sourcePages().some((page) => page.text.includes(item.answer))));
  assert.match(quiz[0].explanation, /page \d+ of biology-notes\.pdf/);

  const correct = evaluateQuizAnswer(quiz[0], quiz[0].answer);
  assert.equal(correct.correct, true);
  assert.match(correct.feedback, /matches key terms from the source/);
  const incorrect = evaluateQuizAnswer(quiz[0], 'completely unrelated response');
  assert.equal(incorrect.correct, false);
  assert.match(incorrect.feedback, /hint/);
});

test('scanned PDFs without extracted text receive a clear local-mode limitation message', () => {
  const response = generateTeachingResponse({
    pages: [{ page: 1, text: '   ' }, { page: 2, text: '' }],
    fileName: 'scanned.pdf',
    question: 'What is shown?',
  });
  assert.equal(response.available, false);
  assert.equal(response.reason, 'empty');
  assert.match(response.answer, /no extractable text/i);
  assert.match(response.answer, /image-only scanned pages/i);
  assert.deepEqual(response.quiz, []);
});

test('unmatched questions are not answered with unrelated PDF facts', () => {
  const response = generateTeachingResponse({
    pages: sourcePages(),
    fileName: 'biology-notes.pdf',
    question: 'How do black holes evaporate?',
  });
  assert.equal(response.available, false);
  assert.equal(response.reason, 'unsupported');
  assert.match(response.answer, /not enough information in this PDF/i);
  assert.deepEqual(response.pages, []);
});

test('short selected passages without a complete reliable sentence are not taught as facts', () => {
  const response = generateTeachingResponse({
    pages: [{ page: 9, text: 'Light plants.' }],
    fileName: 'brief.pdf',
    question: 'Explain light plants',
  });
  assert.equal(response.available, false);
  assert.equal(response.reason, 'insufficient-passage');
  assert.match(response.answer, /not enough readable source text/i);
});
