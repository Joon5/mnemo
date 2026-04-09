/**
 * /api/convert — PDF → .mne converter
 *
 * POST multipart/form-data with:
 *   file     — the PDF file (required)
 *   title    — override title (optional)
 *   subject  — subject/course label (optional)
 *   author   — content author (optional)
 *
 * Returns the .mne file as JSON with Content-Disposition: attachment.
 *
 * Flow:
 *   1. Receive PDF via multipart upload
 *   2. Extract text with pdf-parse (server-side, no browser needed)
 *   3. Call /api/prime (Anthropic proxy) for AI processing:
 *      a. Schema + flashcards (Sonnet)
 *      b. Comprehension checkpoints (Haiku)
 *      c. Semantic word coloring in chunks (Sonnet)
 *   4. Build compact .mne word array
 *   5. Return .mne file for download
 *
 * Install dependency if not present:  npm install pdf-parse
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID }                from 'crypto';

// ── Constants (must match create-mne.js spec) ────────────────────────────────
const MODEL_SMART = 'claude-sonnet-4-20250514';
const MODEL_FAST  = 'claude-haiku-4-5-20251001';
const CHUNK_SIZE  = 800; // words per semantic-coloring chunk

// ── CORS headers ──────────────────────────────────────────────────────────────
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS });
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1. Parse multipart form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data', code: 'INVALID_REQUEST' },
      { status: 400, headers: CORS }
    );
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || typeof fileEntry === 'string') {
    return NextResponse.json(
      { error: 'Missing "file" field in form data', code: 'MISSING_FILE' },
      { status: 400, headers: CORS }
    );
  }

  const uploadedFile = fileEntry as File;
  if (!uploadedFile.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json(
      { error: 'Only PDF files are supported', code: 'UNSUPPORTED_TYPE' },
      { status: 415, headers: CORS }
    );
  }

  // Max 20 MB
  if (uploadedFile.size > 20 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'File too large (max 20 MB)', code: 'FILE_TOO_LARGE' },
      { status: 413, headers: CORS }
    );
  }

  const titleOverride   = formData.get('title')?.toString()   || '';
  const subjectOverride = formData.get('subject')?.toString() || '';
  const authorOverride  = formData.get('author')?.toString()  || '';

  // 2. Extract PDF text
  let rawText: string;
  try {
    rawText = await extractPdfText(uploadedFile);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: 'PDF extraction failed: ' + msg, code: 'PDF_PARSE_ERROR' },
      { status: 422, headers: CORS }
    );
  }

  const words = tokenize(rawText);
  if (words.length < 10) {
    return NextResponse.json(
      { error: 'PDF contains too little text (< 10 words)', code: 'CONTENT_TOO_SHORT' },
      { status: 422, headers: CORS }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'YOUR_ANTHROPIC_API_KEY_HERE') {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured', code: 'API_KEY_MISSING' },
      { status: 503, headers: CORS }
    );
  }

  const baseName = uploadedFile.name.replace(/\.pdf$/i, '');
  const title    = titleOverride   || baseName.replace(/[-_]/g, ' ');
  const subject  = subjectOverride || '';
  const author   = authorOverride  || '';

  // 3a. Schema + flashcards
  // For long texts: sample beginning, middle, and end so Claude sees the full arc.
  const SAMPLE_CHARS = 4000;
  const mid = Math.floor(rawText.length / 2);
  const textSample = words.length > 2000
    ? rawText.slice(0, SAMPLE_CHARS) + '\n\n[...middle of document...]\n\n' +
      rawText.slice(mid - SAMPLE_CHARS / 2, mid + SAMPLE_CHARS / 2) + '\n\n[...end of document...]\n\n' +
      rawText.slice(-SAMPLE_CHARS)
    : rawText;

  const schemaPrompt =
    `Return ONLY valid JSON. Analyze this text comprehensively.\n\n` +
    `Text (${words.length} words total — beginning, middle, and end sampled):\n"""${textSample.slice(0, 12000)}"""\n\n` +
    `{"summary":"2-3 sentences orienting the reader","keywords":["5-8 key terms"],"themes":["2-4 major themes"],"flashcards":[{"q":"...","a":"..."},{"q":"...","a":"..."},{"q":"...","a":"..."}]}`;

  const rawSchema = await callClaude(schemaPrompt, 900, MODEL_SMART, apiKey);
  let schema = { summary: rawText.slice(0, 200), keywords: [] as string[], themes: [] as string[] };
  let cards:  { q: string; a: string }[] = [];
  try {
    if (rawSchema) {
      const p = JSON.parse(rawSchema.replace(/```json|```/g, '').trim());
      schema = { summary: p.summary || schema.summary, keywords: p.keywords || [], themes: p.themes || [] };
      cards  = p.flashcards || [];
    }
  } catch { /* use fallback schema */ }

  // Build a document-level context string passed to every chunk call
  const docContext = [
    schema.summary,
    schema.keywords?.length ? 'Key terms: ' + schema.keywords.join(', ') : '',
    schema.themes?.length   ? 'Themes: '   + schema.themes.join(', ')   : '',
  ].filter(Boolean).join(' | ');

  // 3b. Comprehension checkpoints
  // Sample text around each checkpoint position so all questions are meaningful.
  const cp25 = Math.floor(words.length * 0.25);
  const cp50 = Math.floor(words.length * 0.5);
  const cp75 = Math.floor(words.length * 0.75);
  const CPWIN = 600;
  const cpSample = words.length > 2000
    ? `Beginning:\n"""${words.slice(0, CPWIN).join(' ')}"""\n\n` +
      `~25% (word ${cp25}):\n"""${words.slice(Math.max(0, cp25 - CPWIN/2), cp25 + CPWIN/2).join(' ')}"""\n\n` +
      `~50% (word ${cp50}):\n"""${words.slice(Math.max(0, cp50 - CPWIN/2), cp50 + CPWIN/2).join(' ')}"""\n\n` +
      `~75% (word ${cp75}):\n"""${words.slice(Math.max(0, cp75 - CPWIN/2), cp75 + CPWIN/2).join(' ')}"""`
    : `Text: """${rawText.slice(0, 8000)}"""`;

  const checkPrompt =
    `Return ONLY valid JSON. Generate 3 multiple-choice comprehension checkpoints for a ${words.length}-word text.\n` +
    `Document context: ${docContext}\n\n` +
    `CP1 covers the first quarter (at=0.25), CP2 the first half (at=0.5), CP3 through three-quarters (at=0.75).\n` +
    `Each question must be answerable from the sampled passage near that position.\n\n` +
    `{"checks":[{"q":"...","o":["correct","wrong1","wrong2","wrong3"],"c":0,"at":0.25},{"q":"...","o":["..."],"c":0,"at":0.5},{"q":"...","o":["..."],"c":0,"at":0.75}]}\n\n` +
    cpSample;

  const rawChecks = await callClaude(checkPrompt, 900, MODEL_FAST, apiKey);
  let checks: { q: string; o: string[]; c: number; at: number }[] = [];
  try {
    if (rawChecks) {
      const p = JSON.parse(rawChecks.replace(/```json|```/g, '').trim());
      checks = p.checks || p.checkpoints || [];
    }
  } catch { /* no checkpoints */ }

  // 3c. Semantic word coloring (chunked across full text)
  // Each chunk receives docContext so the model knows global themes while scoring locally.
  const colorCodes = new Array(words.length).fill(0);
  const cumFreq: Record<string, number> = {};
  const COMMON = new Set(['that','this','with','from','have','been','were','they','their','them','than','when','what','which','would','could','should','about','into','more','some','also','very','just','only','will','each','make','like','then','does','made','said','over','such','take','most','much','well','back','even','good','give','many','here','know','come','both']);
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z]/g, '');

  for (let start = 0; start < words.length; start += CHUNK_SIZE) {
    const end   = Math.min(start + CHUNK_SIZE, words.length);
    const chunk = words.slice(start, end);
    const ctx   = [
      words.slice(Math.max(0, start - 100), start).join(' '),
      chunk.join(' '),
      words.slice(end, Math.min(words.length, end + 100)).join(' '),
    ].filter(Boolean).join(' … ');

    const familiar = Object.entries(cumFreq).filter(([, c]) => c >= 3).map(([w]) => w);
    const chunkColors = await getWordColors(chunk, ctx, familiar, apiKey, docContext);

    for (let i = 0; i < chunk.length; i++) {
      colorCodes[start + i] = chunkColors[i] || 0;
      const n = norm(chunk[i]);
      if (n.length >= 4 && !COMMON.has(n)) cumFreq[n] = (cumFreq[n] || 0) + 1;
    }
  }

  // 4. Build compact .mne word array
  const highlightCount: Record<string, number> = {};
  const FAM_THRESH = 3;
  const mneWords: (string | [string, number] | [string, number, 1])[] = [];

  for (let i = 0; i < words.length; i++) {
    const w   = words[i];
    const n   = norm(w);
    let code  = colorCodes[i];

    if (/^mnemo/i.test(n)) {
      code = 3;
    } else if (code === 1 || code === 2) {
      const prev = highlightCount[n] || 0;
      if (prev >= FAM_THRESH     && code === 1) code = 0;
      if (prev >= FAM_THRESH + 2 && code === 2) code = 0;
      if (code) highlightCount[n] = (highlightCount[n] || 0) + 1;
    }

    const isSentEnd = /[.!?]["']?$/.test(w);
    const pause     = (code > 0 || isSentEnd) ? 1 : 0;

    if (code === 0 && !pause) {
      mneWords.push(w);
    } else if (code > 0 && !pause) {
      mneWords.push([w, code]);
    } else if (code === 0 && pause) {
      mneWords.push([w, 0, 1]);
    } else {
      mneWords.push([w, code, 1]);
    }
  }

  // 5. Assemble final .mne object
  const mne = {
    v:       1,
    id:      randomUUID(),
    created: new Date().toISOString(),
    meta: {
      title,
      ...(subject ? { subject } : {}),
      ...(author  ? { author  } : {}),
      source: uploadedFile.name,
      lang:   'en',
      wc:     words.length,
      mins:   Math.max(1, Math.round(words.length / 350)),
      model:  MODEL_SMART,
    },
    schema,
    words:  mneWords,
    ...(cards.length  ? { cards  } : {}),
    ...(checks.length ? { checks } : {}),
  };

  const filename = baseName.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mne';

  return new NextResponse(JSON.stringify(mne, null, 0), {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type':        'application/x-mne',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

// ── PDF text extraction ───────────────────────────────────────────────────────
async function extractPdfText(file: File): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const buf      = Buffer.from(await file.arrayBuffer());
    const data     = await pdfParse(buf);
    return data.text || '';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Cannot find module 'pdf-parse'")) {
      throw new Error("pdf-parse not installed. Run: npm install pdf-parse");
    }
    throw e;
  }
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────
function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(w => w.length > 0);
}

// ── Anthropic API call (direct — bypasses rate limiter for internal use) ──────
async function callClaude(
  content: string,
  maxTokens: number,
  model: string,
  apiKey: string
): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content }],
      }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data.content || []).map((c: { text?: string }) => c.text || '').join('') || '';
  } catch {
    return '';
  }
}

// ── Semantic word coloring ────────────────────────────────────────────────────
async function getWordColors(
  words: string[],
  contextText: string,
  familiarTerms: string[],
  apiKey: string,
  docContext = ''
): Promise<number[]> {
  const wc      = words.length;
  const famNote = familiarTerms.length
    ? `\n\nFAMILIARITY DECAY — do NOT re-highlight these unless used in a new way: [${familiarTerms.slice(0, 40).join(', ')}]`
    : '';
  const docNote = docContext
    ? `DOCUMENT CONTEXT (use to understand which terms matter globally):\n"""${docContext}"""\n\n`
    : '';

  const prompt =
    `Return ONLY valid JSON. You are an expert semantic weight scorer for a speed-reading app.\n\n` +
    docNote +
    `LOCAL PASSAGE:\n"""${contextText.slice(0, 2500)}"""\n\n` +
    `═══ WEIGHTING RULES ═══\n` +
    `"orange" (code 2) — CORE CONCEPTS: primary categories the text is fundamentally about. LIMIT: 2-4 per 100 words.\n` +
    `"green"  (code 1) — QUALIFIERS: contrasts, methods, evaluative terms, first-use named examples. LIMIT: 4-6 per 100 words.\n` +
    `null     (code 0) — everything else.\n` +
    famNote + `\n\n` +
    `Return: {"wordColors":[exactly ${wc} values, each 0/1/2/3 or null]}\n\n` +
    `Words (${wc}): ${words.join(' ')}`;

  const raw = await callClaude(prompt, 3000, MODEL_SMART, apiKey);
  if (!raw) return new Array(wc).fill(0);

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const colors = (parsed.wordColors || []).map((c: number | null) => c === null ? 0 : Number(c));
    if (colors.length === wc) return colors;
    return [...colors, ...new Array(Math.max(0, wc - colors.length)).fill(0)].slice(0, wc);
  } catch {
    return new Array(wc).fill(0);
  }
}
