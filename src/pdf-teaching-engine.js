const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'been', 'before', 'being', 'between',
  'both', 'could', 'does', 'each', 'from', 'have', 'into', 'more', 'most', 'other',
  'over', 'same', 'should', 'some', 'such', 'than', 'that', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'under', 'very', 'what', 'when',
  'where', 'which', 'while', 'with', 'would', 'your', 'you', 'the', 'and', 'for', 'are',
  'was', 'were', 'has', 'had', 'its', 'not', 'but', 'can', 'may', 'will', 'all', 'any',
  'how', 'why', 'who', 'one', 'two', 'three', 'use', 'using', 'used', 'does', 'did',
  'explain', 'describe', 'tell', 'about', 'mean', 'means', 'please', 'summarize',
  'summary', 'document', 'source', 'information', 'important', 'point', 'points', 'pdf',
  'can', 'could', 'show', 'given',
]);

function words(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [])
    .map((word) => word.replace(/['’-]/g, ''))
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function sentenceList(text) {
  return text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

function classifyParagraph(text) {
  const trimmed = text.trim();
  const numberMatch = trimmed.match(/^(?:step\s*(\d{1,2})|(\d{1,2})[.)])[:.)]?\s+/i);
  if (numberMatch) return { kind: 'numbered-step', stepNumber: Number(numberMatch[1] || numberMatch[2]) };
  if (/^(?:example|for example|e\.g\.|illustration)\b/i.test(trimmed)) return { kind: 'example' };
  if (/[=≈≠≤≥+\-*/^∑∫]|\\frac|\\sum/.test(trimmed) && /\d|[a-z]\s*[=+\-*/^]/i.test(trimmed)) {
    return { kind: 'formula' };
  }
  if (/^.{1,90}\b(?:is|are|means|refers to|defined as|describes)\b/i.test(trimmed)) {
    return { kind: 'definition' };
  }
  const letters = trimmed.match(/\p{L}/gu) || [];
  const uppercase = trimmed.match(/\p{Lu}/gu) || [];
  if (trimmed.length <= 100 && letters.length >= 3 && uppercase.length / letters.length > 0.65) {
    return { kind: 'heading' };
  }
  return { kind: 'paragraph' };
}

function splitIntoParagraphs(text) {
  return text
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export async function extractPdfPageTexts(documentProxy) {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.filter((item) => typeof item.str === 'string' && item.str.trim());
    const hasPositions = items.some((item) => Array.isArray(item.transform) && Number.isFinite(item.transform[5]));
    let text;
    if (hasPositions) {
      const lineMap = new Map();
      let order = 0;
      for (const item of items) {
        const y = Array.isArray(item.transform) && Number.isFinite(item.transform[5])
          ? Math.round(item.transform[5] / 2) * 2
          : null;
        let line = lineMap.get(y);
        if (!line) {
          line = { y, parts: [], order: order++ };
          lineMap.set(y, line);
        }
        line.parts.push(item.str.trim());
      }
      text = [...lineMap.values()]
        .sort((a, b) => (b.y ?? -Infinity) - (a.y ?? -Infinity) || a.order - b.order)
        .map((line) => line.parts.join(' '))
        .join('\n');
    } else {
      text = items.map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('');
    }
    pages.push({
      page: pageNumber,
      text: text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    });
  }
  return pages;
}

export function analyzePdf(pages, fileName = 'Uploaded PDF') {
  const sections = [];
  const analyzedPages = pages.map(({ page, text = '' }) => {
    let currentSection = `Page ${page}`;
    const paragraphs = splitIntoParagraphs(text).map((paragraph) => {
      const classification = classifyParagraph(paragraph);
      if (classification.kind === 'heading') currentSection = paragraph;
      const entry = {
        page,
        section: currentSection,
        text: paragraph,
        kind: classification.kind,
        ...(classification.stepNumber ? { stepNumber: classification.stepNumber } : {}),
        terms: [...new Set(words(paragraph))],
      };
      if (classification.kind === 'heading') sections.push({ page, title: paragraph });
      return entry;
    });
    return { page, text, paragraphs };
  });
  const allParagraphs = analyzedPages.flatMap((page) => page.paragraphs);
  const frequencies = new Map();
  for (const paragraph of allParagraphs) {
    for (const term of paragraph.terms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  }
  const keywords = [...frequencies]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([term]) => term);
  return {
    fileName: fileName || 'Uploaded PDF',
    pages: analyzedPages,
    sections,
    paragraphs: allParagraphs.filter((paragraph) => paragraph.kind !== 'heading' && paragraph.text),
    keywords,
    hasText: allParagraphs.some((paragraph) => paragraph.kind !== 'heading' && paragraph.text.length > 0),
  };
}

export function selectRelevantPassages(document, question, limit = 4) {
  const queryTerms = [...new Set(words(question))];
  if (!document?.hasText || queryTerms.length === 0 || queryTerms.length > 12) return [];
  if (queryTerms.some((term) => term.length < 4)) return [];
  const queryText = question.toLowerCase();
  return document.paragraphs
    .map((paragraph) => {
      const passageTerms = new Set(paragraph.terms);
      const matches = queryTerms.filter((term) => passageTerms.has(term));
      const score = matches.reduce((total, term) => total + Math.min(3, paragraph.terms.filter((word) => word === term).length), 0)
        + (paragraph.kind === 'definition' ? 0.5 : 0)
        + (paragraph.kind === 'numbered-step' && /\bstep|process|order|sequence\b/i.test(queryText) ? 1 : 0);
      return { ...paragraph, score, matchedTerms: matches };
    })
    .filter((paragraph) => paragraph.score > 0 && paragraph.matchedTerms.length / queryTerms.length >= 0.5)
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, Math.max(1, limit));
}

function uniqueSentences(passages) {
  const seen = new Set();
  const sentences = [];
  for (const passage of passages) {
    for (const text of sentenceList(passage.text)) {
      const key = text.toLowerCase();
      if (words(text).length >= 4 && !seen.has(key)) {
        seen.add(key);
        sentences.push({ text, page: passage.page, kind: passage.kind, terms: [...new Set(words(text))] });
      }
    }
  }
  return sentences;
}

function createQuiz(document) {
  const candidates = uniqueSentences(document.paragraphs);
  return candidates.slice(0, 3).map((candidate, index) => {
    const term = candidate.terms.find((word) => document.keywords.includes(word)) || candidate.terms[0];
    const prompt = candidate.kind === 'definition'
      ? `According to ${document.fileName}, what does the passage say about “${term}”?`
      : candidate.kind === 'numbered-step'
        ? `What does step ${candidate.stepNumber} state in ${document.fileName}?`
        : candidate.kind === 'formula'
          ? `What formula or relationship is shown on page ${candidate.page} of ${document.fileName}?`
          : `State one key point from page ${candidate.page} of ${document.fileName}.`;
    return {
      id: index,
      prompt,
      answer: candidate.text,
      explanation: `This expected answer is taken from page ${candidate.page} of ${document.fileName}.`,
      hint: `Look for the source passage containing “${term}” on page ${candidate.page}.`,
      page: candidate.page,
      terms: candidate.terms,
    };
  });
}

export function makeDocumentQuiz(pages, fileName) {
  const document = analyzePdf(pages || [], fileName);
  return document.hasText ? createQuiz(document) : [];
}

export function evaluateQuizAnswer(question, response) {
  const expected = [...new Set(words(question?.answer || ''))];
  const supplied = new Set(words(response || ''));
  const matchingTerms = expected.filter((term) => supplied.has(term));
  const threshold = Math.min(2, expected.length);
  const correct = threshold > 0 && matchingTerms.length >= threshold;
  return {
    correct,
    matchingTerms,
    feedback: correct
      ? `Good work. Your answer matches key terms from the source: ${matchingTerms.join(', ')}.`
      : 'That does not yet match enough key terms from the source. Review the hint and try again.',
  };
}

export function generateTeachingResponse({ pages, fileName, question }) {
  const document = analyzePdf(pages || [], fileName);
  if (!document.hasText) {
    return {
      available: false,
      reason: 'empty',
      answer: `${document.fileName} has no extractable text. This local teaching mode cannot read image-only scanned pages. Try a text-based PDF; OCR and image understanding are not enabled.`,
      fileName: document.fileName,
      pages: [],
      keyTerms: [],
      quiz: [],
    };
  }

  const passages = selectRelevantPassages(document, question);
  if (!passages.length) {
    return {
      available: false,
      reason: 'unsupported',
      answer: `I could not find a reliable matching passage for that question in ${document.fileName}. There is not enough information in this PDF to answer it. Try asking about a heading or term shown in the document.`,
      fileName: document.fileName,
      pages: [],
      keyTerms: [],
      quiz: createQuiz(document),
    };
  }

  const facts = uniqueSentences(passages);
  if (!facts.length) {
    return {
      available: false,
      reason: 'insufficient-passage',
      answer: `There is not enough readable source text in ${document.fileName} to create a reliable answer to that question.`,
      fileName: document.fileName,
      pages: [],
      keyTerms: [],
      quiz: createQuiz(document),
    };
  }
  const explanationFacts = facts.slice(0, 2);
  const keyTerms = [...new Set(passages.flatMap((passage) => passage.matchedTerms.length ? passage.matchedTerms : passage.terms))]
    .slice(0, 6)
    .map((term) => {
      const passage = passages.find((candidate) => candidate.terms.includes(term));
      return { term, page: passage.page };
    });
  const points = facts.slice(0, 3).map((fact) => ({ text: fact.text, page: fact.page }));
  const sourceReferences = [...new Set(passages.map((passage) => passage.page))]
    .map((page) => ({ fileName: document.fileName, page }));
  const explanation = explanationFacts
    .map((fact) => `On page ${fact.page}, the PDF states: ${fact.text}`)
    .join(' ');
  const example = `Illustrative example, not from the PDF: use “${keyTerms[0]?.term || 'the key idea'}” as a prompt and explain it using the source passage above.`;
  const summary = explanationFacts.map((fact) => fact.text).join(' ');
  const memoryAid = keyTerms.length >= 2
    ? `Recall these source keywords: ${keyTerms.slice(0, 3).map((item) => item.term).join(' → ')}. This memory cue is constructed from the PDF's wording.`
    : `To remember the idea, restate the key source term “${keyTerms[0]?.term || 'the idea'}” and its explanation from page ${sourceReferences[0].page}.`;
  const quiz = createQuiz(document);
  const answer = [
    `Rule-based teaching from ${document.fileName}; no generative AI was used.`,
    `Simple explanation: ${explanation}`,
    `Important points: ${points.map((point) => point.text).join(' ')}`,
    `Key terms: ${keyTerms.map((item) => `${item.term} (page ${item.page})`).join(', ')}.`,
    example,
    `Short summary: ${summary}`,
    `Memory aid: ${memoryAid}`,
    `Source pages: ${sourceReferences.map((source) => `${source.fileName}, page ${source.page}`).join('; ')}.`,
  ].join('\n\n');
  const steps = explanationFacts.map((fact) => ({
    speech: `From ${document.fileName}, page ${fact.page}: ${fact.text}`,
    page: fact.page,
    reveal: 1,
  }));

  return {
    available: true,
    fileName: document.fileName,
    answer,
    explanation,
    points,
    keyTerms,
    example,
    summary,
    memoryAid,
    sourceReferences,
    quiz,
    steps,
    sections: document.sections,
  };
}
