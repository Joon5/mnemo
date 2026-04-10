"use client";
import { useState, useRef, useCallback, useEffect } from "react";

// ── mnemo .mne Reader — v1 format (compact encoding) ──
// Parses pre-processed .mne files (v1 spec) and plays them instantly.
// No AI required at read time — all processing was done at creation.

// ── v1 Format types ──────────────────────────────────────────────────────────
// words array: string | [text: string, colorCode: 0|1|2|3, pause?: 0|1]
// color codes: 0=null, 1="green", 2="orange", 3="mnemo"
// chapters: { i, t, s, e }   (index, title, start word, end word)
// cards: { q, a }            (flashcards)
// checks: { q, o, c, at }   (MCQ checkpoints, at = 0.25/0.5/0.75)

type WordRaw = string | [string, number, (0 | 1)?];

interface MneCheck { q: string; o: string[]; c: number; at: number }

interface MneFile {
  v: number;
  id?: string;
  created?: string;
  meta: {
    title: string;
    subject?: string;
    author?: string;
    source?: string;
    lang?: string;
    wc: number;
    mins: number;
    model?: string;
  };
  schema?: { summary: string; keywords: string[]; themes?: string[] };
  chapters?: { i: number; t: string; s: number; e: number }[];
  words: WordRaw[];
  cards?: { q: string; a: string }[];
  checks?: MneCheck[];
}

interface ParsedWord {
  t: string;
  c: string | null; // null | "green" | "orange" | "mnemo"
  p: boolean;       // pause / weighted delay
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const CODE_TO_COLOR: Record<number, string | null> = {
  0: null,
  1: "green",
  2: "orange",
  3: "mnemo",
};

function parseWords(raw: WordRaw[]): ParsedWord[] {
  return raw.map((w) => {
    if (typeof w === "string") {
      // Plain string — no highlight, no extra pause (unless sentence-end)
      const p = /[.!?]["']?$/.test(w);
      return { t: w, c: null, p };
    }
    const [text, code, pause] = w;
    return {
      t: text,
      c: CODE_TO_COLOR[code] ?? null,
      p: pause === 1 || code > 0 || /[.!?]["']?$/.test(text),
    };
  });
}

function pivot(w: string): number {
  const c = w.replace(/[^a-zA-Z0-9]/g, "");
  const l = c.length;
  if (l <= 1) return 0;
  if (l <= 5) return 1;
  return Math.floor(l * 0.35);
}

const BASE = 196, WEIGHTED = 210, INTRO = 316;

function getDelay(w: ParsedWord, idx: number, wpm: number): number {
  const raw = idx === 0 ? INTRO : w.p ? WEIGHTED : BASE;
  return Math.round(raw * (350 / wpm));
}

function colorStyle(c: string | null): string {
  if (c === "orange") return "#f5a623";
  if (c === "green")  return "#00c896";
  if (c === "mnemo")  return "#00c896";
  return "#ffffff";
}

function curChapter(
  idx: number,
  chapters?: MneFile["chapters"]
): string {
  if (!chapters?.length) return "";
  for (const ch of chapters) {
    if (idx >= ch.s && idx <= ch.e) return ch.t;
  }
  return "";
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MneReader() {
  const [file, setFile]         = useState<MneFile | null>(null);
  const [words, setWords]       = useState<ParsedWord[]>([]);
  const [screen, setScreen]     = useState<"load"|"prime"|"read"|"check"|"done">("load");
  const [wordBefore, setWordBefore] = useState("");
  const [wordPivot, setWordPivot]   = useState("—");
  const [wordAfter, setWordAfter]   = useState("");
  const [wordColor, setWordColor]   = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [wpm, setWpm]           = useState(350);
  const [isPaused, setIsPaused] = useState(false);
  const [chapter, setChapter]   = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [flipped, setFlipped]   = useState<Set<number>>(new Set());
  const [seen, setSeen]         = useState<Set<number>>(new Set());
  const [bars, setBars]         = useState<{ h: number; c: string }[]>([]);
  const [activebar, setActivebar] = useState(-1);
  const [error, setError]       = useState("");

  // Checkpoint state
  const [checkQ, setCheckQ]       = useState<MneCheck | null>(null);
  const [checkShuffled, setCheckShuffled] = useState<string[]>([]);
  const [checkResult, setCheckResult]     = useState<"correct"|"wrong"|null>(null);
  const [firedChecks, setFiredChecks]     = useState<Set<number>>(new Set());

  const r = useRef({ idx: 0, timer: null as ReturnType<typeof setTimeout> | null });
  const isPausedRef    = useRef(false);
  const wpmRef         = useRef(350);
  const wordsRef       = useRef<ParsedWord[]>([]);
  const fileRef        = useRef<MneFile | null>(null);
  const firedChecksRef = useRef<Set<number>>(new Set());

  // keep refs in sync
  useEffect(() => { wpmRef.current = wpm; }, [wpm]);
  useEffect(() => { wordsRef.current = words; }, [words]);
  useEffect(() => { fileRef.current = file; }, [file]);
  useEffect(() => { firedChecksRef.current = firedChecks; }, [firedChecks]);

  // ── Semantic weight bars ──
  const buildBars = useCallback((ws: ParsedWord[]) => {
    const total = ws.length;
    const step  = Math.max(1, Math.floor(total / 180));
    const b: { h: number; c: string }[] = [];
    for (let i = 0; i < total; i += step) {
      const w = ws[i];
      let h = 4, c = "#1e3347";
      if (w.c === "orange")     { h = 44; c = "#f5a623"; }
      else if (w.c === "green" || w.c === "mnemo") { h = 36; c = "#00c896"; }
      else if (w.p)              { h = 20; c = "#3a5068"; }
      else                       { h = 4 + Math.random() * 6; }
      b.push({ h, c });
    }
    setBars(b);
  }, []);

  // ── Checkpoint check ──
  const checkForCheckpoint = useCallback((idx: number, totalWords: number) => {
    const f = fileRef.current;
    if (!f?.checks?.length) return false;
    const frac = idx / totalWords;
    for (const ck of f.checks) {
      const key = ck.at;
      if (!firedChecksRef.current.has(key) && frac >= ck.at) {
        setFiredChecks(prev => new Set(prev).add(key));
        // Shuffle options (correct answer is always index 0 before shuffle)
        const shuffled = [...ck.o].sort(() => Math.random() - 0.5);
        setCheckQ(ck);
        setCheckShuffled(shuffled);
        setCheckResult(null);
        return true;
      }
    }
    return false;
  }, []);

  // ── Core reader loop ──
  const runReader = useCallback(() => {
    const ws   = wordsRef.current;
    const tick = () => {
      if (isPausedRef.current) return;
      const { idx } = r.current;
      if (idx >= ws.length) { setScreen("done"); return; }

      // Check for comprehension checkpoint
      if (checkForCheckpoint(idx, ws.length)) {
        isPausedRef.current = true;
        setIsPaused(true);
        setScreen("check");
        r.current.idx = idx; // don't advance
        return;
      }

      const w = ws[idx];
      const p = pivot(w.t);
      setWordBefore(w.t.slice(0, p));
      setWordPivot(w.t[p] || "");
      setWordAfter(w.t.slice(p + 1));
      setWordColor(w.c);
      setProgress(Math.round((idx / ws.length) * 100));

      const barIdx = Math.floor((idx / ws.length) * (bars.length || 180));
      setActivebar(barIdx);
      if (idx % 30 === 0) setChapter(curChapter(idx, fileRef.current?.chapters));

      const delay = getDelay(w, idx, wpmRef.current);
      r.current.timer = setTimeout(tick, delay);
      r.current.idx++;
    };
    if (r.current.timer) { clearTimeout(r.current.timer); r.current.timer = null; }
    tick();
  }, [bars.length, checkForCheckpoint]);

  // ── File loading ──
  const loadFile = async (f: File) => {
    setError("");
    try {
      const text = await f.text();
      const data: MneFile = JSON.parse(text);
      if (data.v !== 1 || !Array.isArray(data.words) || !data.words.length) {
        throw new Error("Not a valid .mne v1 file");
      }
      const parsed = parseWords(data.words);
      setFile(data);
      setWords(parsed);
      wordsRef.current  = parsed;
      fileRef.current   = data;
      setFiredChecks(new Set());
      firedChecksRef.current = new Set();
      buildBars(parsed);
      setScreen("prime");
    } catch {
      setError("Could not read file. Make sure it's a valid .mne file (v1).");
    }
  };

  // ── Start / pause / resume ──
  const startReading = useCallback(() => {
    if (!words.length) return;
    r.current.idx = 0;
    isPausedRef.current = false;
    setIsPaused(false);
    setProgress(0);
    setActivebar(-1);
    setScreen("read");
    setTimeout(runReader, 100);
  }, [words, runReader]);

  const resumeAfterCheck = useCallback(() => {
    setScreen("read");
    isPausedRef.current = false;
    setIsPaused(false);
    setCheckQ(null);
    setTimeout(runReader, 100);
  }, [runReader]);

  const togglePause = useCallback(() => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
    if (!next) runReader();
    else if (r.current.timer) { clearTimeout(r.current.timer); r.current.timer = null; }
  }, [runReader]);

  // Spacebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" && screen === "read") { e.preventDefault(); togglePause(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [screen, togglePause]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: "#0b1623", minHeight: "100vh", color: "#fff", fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@700;800&family=Inter:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .hdr { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; border-bottom: 1px solid #1e3347; }
        .logo { font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 800; letter-spacing: -.04em; }
        .logo .lm { color: #00c896; }
        .btn { background: none; border: 1.5px solid #1e3347; color: #e8edf2; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 12px; font-family: 'Outfit', sans-serif; font-weight: 700; letter-spacing: .06em; transition: all .15s; }
        .btn:hover { border-color: #00c896; color: #00c896; }
        .btn.pri { background: #00c896; border-color: #00c896; color: #0b1623; }
        .btn.pri:hover { background: #00a87a; }
        .btn.wrong { background: #e05555; border-color: #e05555; color: #fff; }
        .drop-zone { border: 2px dashed #1e3347; border-radius: 12px; padding: 60px 40px; text-align: center; cursor: pointer; transition: all .2s; }
        .drop-zone.over { border-color: #00c896; background: rgba(0,200,150,.05); }
        .fc-card { perspective: 1000px; height: 110px; cursor: pointer; border-radius: 10px; margin-bottom: 10px; }
        .fc-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform .45s cubic-bezier(.4,0,.2,1); border-radius: 10px; }
        .fc-card.flipped .fc-inner { transform: rotateY(180deg); }
        .fc-face { position: absolute; inset: 0; border-radius: 10px; backface-visibility: hidden; -webkit-backface-visibility: hidden; display: flex; flex-direction: column; justify-content: center; padding: 16px 20px; border: 1.5px solid #1e3347; }
        .fc-front { background: #111f2e; }
        .fc-back { background: linear-gradient(135deg, rgba(0,200,150,.08) 0%, #111f2e 100%); border-color: #00a87a; transform: rotateY(180deg); }
        .fc-lbl { font-family: 'Outfit', sans-serif; font-size: 9px; font-weight: 700; letter-spacing: .12em; margin-bottom: 6px; color: #00c896; }
        .fc-back .fc-lbl { color: #00a87a; }
        .fc-txt { font-size: 13px; line-height: 1.5; color: #e8edf2; }
        .wbar { display: flex; align-items: flex-end; gap: 1px; height: 60px; }
        .progress-bar { height: 3px; background: #1e3347; border-radius: 2px; overflow: hidden; margin: 8px 0; }
        .progress-fill { height: 100%; background: #00c896; transition: width .3s; }
        .opt-btn { width: 100%; padding: 12px 16px; background: #111f2e; border: 1.5px solid #1e3347; border-radius: 8px; color: #e8edf2; font-size: 13px; text-align: left; cursor: pointer; transition: all .15s; margin-bottom: 8px; }
        .opt-btn:hover { border-color: #00c896; }
        .opt-btn.correct { border-color: #00c896; background: rgba(0,200,150,.1); color: #00c896; }
        .opt-btn.wrong { border-color: #e05555; background: rgba(224,85,85,.1); color: #e05555; }
      `}</style>

      {/* Header */}
      <div className="hdr">
        <div className="logo"><span className="lm">m</span>nemo <span style={{ fontSize: 9, border: "1.5px solid #00c896", color: "#00c896", padding: "2px 6px", borderRadius: 3, marginLeft: 6, letterSpacing: ".08em" }}>READER</span></div>
        <div style={{ display: "flex", gap: 8 }}>
          {screen !== "load" && (
            <button className="btn" onClick={() => {
              if (r.current.timer) clearTimeout(r.current.timer);
              setScreen("load"); setFile(null); setWords([]); setProgress(0);
              setFiredChecks(new Set()); firedChecksRef.current = new Set();
            }}>← NEW FILE</button>
          )}
          <a href="/" style={{ color: "#3a5068", fontSize: 11, textDecoration: "none", alignSelf: "center" }}>back to app</a>
        </div>
      </div>

      {/* ── LOAD ── */}
      {screen === "load" && (
        <div style={{ maxWidth: 560, margin: "60px auto", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 36, fontWeight: 800, letterSpacing: "-.04em", marginBottom: 8 }}>
              <span style={{ color: "#00c896" }}>m</span>nemo reader
            </div>
            <div style={{ color: "#3a5068", fontSize: 13 }}>Load a pre-processed .mne file for instant speed reading</div>
          </div>

          <div
            className={`drop-zone${dragOver ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
            onClick={() => document.getElementById("mne-file-input")?.click()}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>📖</div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, marginBottom: 4 }}>Drop your .mne file here</div>
            <div style={{ fontSize: 12, color: "#3a5068" }}>or click to browse</div>
            <input id="mne-file-input" type="file" accept=".mne" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
          </div>

          {error && <div style={{ color: "#e05555", fontSize: 12, marginTop: 12, textAlign: "center" }}>{error}</div>}

          <div style={{ marginTop: 32, padding: 20, background: "#111f2e", borderRadius: 10, border: "1px solid #1e3347" }}>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "#3a5068", letterSpacing: ".1em", marginBottom: 10 }}>WHAT IS A .mne FILE?</div>
            <div style={{ fontSize: 13, color: "#a8b5c2", lineHeight: 1.7 }}>
              A .mne file contains pre-processed reading data — word weights, comprehension checkpoints, and flashcards
              all computed in advance by AI. Load it here for <strong style={{ color: "#00c896" }}>instant reading</strong> with no waiting.
            </div>
            <div style={{ fontSize: 12, color: "#3a5068", marginTop: 10 }}>
              Generate .mne files from PDFs using the mnemo converter, or from the main app.
            </div>
          </div>
        </div>
      )}

      {/* ── PRIME ── */}
      {screen === "prime" && file && (
        <div style={{ maxWidth: 560, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, fontWeight: 800, marginBottom: 4 }}>
            {file.meta.title}
          </div>
          {file.meta.author && (
            <div style={{ color: "#3a5068", fontSize: 12, marginBottom: 4 }}>{file.meta.author}</div>
          )}
          <div style={{ color: "#3a5068", fontSize: 12, marginBottom: 32 }}>
            {file.meta.wc.toLocaleString()} words · ~{file.meta.mins} min
            {file.meta.subject ? ` · ${file.meta.subject}` : ""}
          </div>

          {file.schema && (
            <div style={{ background: "#111f2e", border: "1px solid #1e3347", borderRadius: 10, padding: 20, textAlign: "left", marginBottom: 24 }}>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 9, color: "#00c896", letterSpacing: ".12em", marginBottom: 8 }}>SCHEMA BRIEF</div>
              <div style={{ fontSize: 13, color: "#e8edf2", lineHeight: 1.6, marginBottom: 12 }}>{file.schema.summary}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {file.schema.keywords.map((k, i) => (
                  <span key={i} style={{ fontSize: 10, border: "1px solid #1e3347", borderRadius: 4, padding: "2px 8px", color: "#a8b5c2" }}>{k}</span>
                ))}
              </div>
              {file.schema.themes?.length ? (
                <div style={{ marginTop: 10, fontSize: 11, color: "#3a5068" }}>
                  Themes: {file.schema.themes.join(" · ")}
                </div>
              ) : null}
            </div>
          )}

          {file.checks?.length ? (
            <div style={{ fontSize: 11, color: "#3a5068", marginBottom: 16 }}>
              ✓ {file.checks.length} comprehension checkpoints · {file.cards?.length ?? 0} flashcards
            </div>
          ) : null}

          {/* Semantic weight bars */}
          <div style={{ background: "#111f2e", border: "1px solid #1e3347", borderRadius: 8, padding: "12px 16px", marginBottom: 24 }}>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 9, color: "#3a5068", letterSpacing: ".12em", marginBottom: 8 }}>SEMANTIC WEIGHT</div>
            <div className="wbar">
              {bars.map((b, i) => <div key={i} style={{ width: 3, height: b.h, background: b.c, borderRadius: 1, flex: "0 0 auto" }} />)}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 24 }}>
            <span style={{ fontSize: 11, color: "#3a5068" }}>WPM</span>
            <input type="range" min={150} max={600} step={25} value={wpm} onChange={(e) => setWpm(Number(e.target.value))}
              style={{ flex: 1, maxWidth: 200 }} />
            <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: "#00c896", minWidth: 40 }}>{wpm}</span>
          </div>

          <button className="btn pri" onClick={startReading} style={{ fontSize: 14, padding: "14px 40px" }}>
            START READING →
          </button>
        </div>
      )}

      {/* ── READ ── */}
      {screen === "read" && file && (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 53px)" }}>
          <div style={{ padding: "8px 20px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "#00c896", minWidth: 60 }}>{wpm} WPM</span>
            <div className="progress-bar" style={{ flex: 1 }}>
              <div className="progress-fill" style={{ width: progress + "%" }} />
            </div>
            <span style={{ fontSize: 11, color: "#3a5068", minWidth: 35 }}>{progress}%</span>
          </div>

          {chapter && <div style={{ textAlign: "center", fontSize: 10, color: "#3a5068", letterSpacing: ".1em", paddingBottom: 4 }}>{chapter}</div>}

          {/* ORP display */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "relative", background: "#111f2e", border: "1px solid #1e3347", borderRadius: 12, padding: "28px 40px", minWidth: 280, textAlign: "center" }}>
              <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 2, height: 6, background: "#00c896", borderRadius: "0 0 2px 2px" }} />
              <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, fontWeight: 700, color: "#3a5068" }}>{wordBefore}</span>
              <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, fontWeight: 700, color: colorStyle(wordColor) }}>{wordPivot}</span>
              <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, fontWeight: 700, color: "#e8edf2" }}>{wordAfter}</span>
              <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 2, height: 6, background: "#00c896", borderRadius: "2px 2px 0 0" }} />
            </div>
          </div>

          {/* Semantic weight bars */}
          <div style={{ padding: "8px 20px", background: "#111f2e", borderTop: "1px solid #1e3347" }}>
            <div style={{ fontSize: 9, color: "#1e3347", letterSpacing: ".1em", marginBottom: 4, fontFamily: "'Outfit', sans-serif" }}>SEMANTIC WEIGHT</div>
            <div style={{ display: "flex", alignItems: "flex-end", height: 48, gap: 1, overflow: "hidden" }}>
              {bars.map((b, i) => (
                <div key={i} style={{
                  width: Math.max(2, Math.floor(600 / bars.length)),
                  height: i === activebar ? Math.max(b.h, 16) : b.h,
                  background: i === activebar ? "#fff" : b.c,
                  opacity: i < activebar ? 0.3 : 1,
                  borderRadius: 1, flex: "0 0 auto", transition: "height .1s",
                }} />
              ))}
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderTop: "1px solid #1e3347", flexWrap: "wrap" }}>
            <button className="btn" onClick={() => { r.current.idx = Math.max(0, r.current.idx - 15); }}>◀◀</button>
            <button className="btn pri" onClick={togglePause} style={{ minWidth: 80 }}>{isPaused ? "▶ PLAY" : "⏸ PAUSE"}</button>
            <button className="btn" onClick={() => { r.current.idx = Math.min(words.length - 1, r.current.idx + 15); }}>▶▶</button>
            <input type="range" min={150} max={600} step={25} value={wpm}
              onChange={(e) => setWpm(Number(e.target.value))}
              style={{ flex: 1, minWidth: 80 }} />
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "#00c896", minWidth: 45 }}>{wpm} WPM</span>
          </div>
        </div>
      )}

      {/* ── CHECKPOINT ── */}
      {screen === "check" && checkQ && (
        <div style={{ maxWidth: 500, margin: "60px auto", padding: "0 24px" }}>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10, color: "#00c896", letterSpacing: ".12em", marginBottom: 16, textAlign: "center" }}>
            COMPREHENSION CHECK · {Math.round((r.current.idx / words.length) * 100)}% THROUGH
          </div>
          <div style={{ background: "#111f2e", border: "1px solid #1e3347", borderRadius: 12, padding: 24, marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.6, color: "#e8edf2" }}>{checkQ.q}</div>
          </div>
          <div>
            {checkShuffled.map((opt, i) => {
              let cls = "opt-btn";
              if (checkResult) {
                if (opt === checkQ.o[checkQ.c]) cls += " correct";
                else if (opt === checkShuffled[i] && checkResult === "wrong") cls += " wrong";
              }
              return (
                <button key={i} className={cls} disabled={!!checkResult}
                  onClick={() => {
                    const isCorrect = opt === checkQ.o[checkQ.c];
                    setCheckResult(isCorrect ? "correct" : "wrong");
                  }}>
                  {opt}
                </button>
              );
            })}
          </div>
          {checkResult && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <div style={{ fontSize: 13, color: checkResult === "correct" ? "#00c896" : "#e05555", marginBottom: 16 }}>
                {checkResult === "correct" ? "✓ Correct! Keep going." : `✗ The answer was: "${checkQ.o[checkQ.c]}"`}
              </div>
              <button className="btn pri" onClick={resumeAfterCheck}>CONTINUE READING →</button>
            </div>
          )}
        </div>
      )}

      {/* ── DONE ── */}
      {screen === "done" && file && (
        <div style={{ maxWidth: 560, margin: "40px auto", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 11, color: "#00c896", letterSpacing: ".12em", marginBottom: 8 }}>READING COMPLETE</div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, fontWeight: 800 }}>{file.meta.title}</div>
            <div style={{ color: "#3a5068", fontSize: 12, marginTop: 6 }}>
              {file.meta.wc.toLocaleString()} words · {file.meta.mins} min estimated
            </div>
          </div>

          {/* Flashcards */}
          {(file.cards?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 10, color: "#3a5068", letterSpacing: ".12em", marginBottom: 12 }}>
                SPACED RETRIEVAL · {seen.size}/{file.cards!.length} reviewed
              </div>
              {file.cards!.map((fc, i) => (
                <div key={i} className={`fc-card${flipped.has(i) ? " flipped" : ""}`}
                  onClick={() => {
                    setFlipped(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
                    setSeen(p => new Set(p).add(i));
                  }}>
                  <div className="fc-inner">
                    <div className="fc-face fc-front">
                      <div className="fc-lbl">Q {i + 1}/{file.cards!.length}</div>
                      <div className="fc-txt">{fc.q}</div>
                    </div>
                    <div className="fc-face fc-back">
                      <div className="fc-lbl">ANSWER</div>
                      <div className="fc-txt">{fc.a}</div>
                    </div>
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 8 }}>
                {file.cards!.map((_, i) => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: seen.has(i) ? "#00c896" : "#1e3347" }} />
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn pri" onClick={startReading}>REPLAY</button>
            <button className="btn" onClick={() => { setScreen("load"); setFile(null); setWords([]); }}>LOAD ANOTHER</button>
            <a href="/" style={{ textDecoration: "none" }}><button className="btn">BACK TO APP</button></a>
          </div>
        </div>
      )}
    </div>
  );
}
