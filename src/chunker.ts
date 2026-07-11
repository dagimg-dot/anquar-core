import type { ParsedBook, Block, TextBlock, StyleRun, ChunkConfig } from "./types.ts";

const HEADER_WRAP_LEN = "── ".length + " ──".length;

// ─── Sentence splitting (unchanged, works on plain text) ─────────

/**
 * Split text into sentence-sized pieces using punctuation boundaries.
 */
export function splitSentences(text: string): string[] {
  const ABBREVIATIONS =
    /\b(?:Dr|Mr|Mrs|Ms|St|vs|etc|i\.e|e\.g|dept|approx|Jr|Sr|Prof|Capt|Lt|Col|Gen|Sgt|p\.|pp\.|vol|fig|al|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.$/i;

  const raw = text
    .replace(/\r\n/g, "\n")
    .replace(/\.\.\./g, "\u0000ELLIPSIS\u0000")
    .replace(/\n\n+/g, "\u0000PARA\u0000");

  const marked = raw.replace(
    /(?<![A-Z][a-z]\.)(?<!\b\w\.\w\.)(?<!\.\.\.)([.!?。！？])(["'）」』]*)\s+(?=[\p{Lu}"'（「『]|$)/gu,
    "$1$2\u0000SENT\u0000",
  );

  const candidates = marked
    .split("\u0000SENT\u0000")
    .map((s) => s.replace(/\u0000PARA\u0000/g, "\n\n"))
    .map((s) => s.replace(/\u0000ELLIPSIS\u0000/g, "..."))
    .map((s) => s.trim())
    .filter(Boolean);

  const merged: string[] = [];
  for (const c of candidates) {
    const endsWithTerminal = /[.!?。！？"']$/.test(c);
    const isAbbreviation = ABBREVIATIONS.test(c);
    if (!endsWithTerminal && merged.length > 0 && !isAbbreviation) {
      merged[merged.length - 1] += " " + c;
    } else {
      merged.push(c);
    }
  }

  return merged;
}

// ─── Hard split (unchanged, works on plain text) ────────────────

/**
 * Break a string at the last word boundary before `maxChars`.
 */
export function hardSplit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    const slice = remaining.slice(0, maxChars);
    const lastSpace = slice.lastIndexOf(" ");

    if (lastSpace === -1) {
      chunks.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    } else {
      chunks.push(remaining.slice(0, lastSpace));
      remaining = remaining.slice(lastSpace + 1);
    }
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

// ─── Run-aware operations ───────────────────────────────────────

/**
 * Merge adjacent runs with identical style flags.
 */
function normalizeRuns(runs: StyleRun[]): StyleRun[] {
  if (runs.length <= 1) return runs;
  const out: StyleRun[] = [];
  let cur = runs[0];
  for (let i = 1; i < runs.length; i++) {
    if (cur.bold === runs[i].bold && cur.italic === runs[i].italic) {
      cur = { ...cur, text: cur.text + runs[i].text };
    } else {
      out.push(cur);
      cur = runs[i];
    }
  }
  out.push(cur);
  return out;
}

/**
 * Split StyleRun[] at sentence boundaries.
 * Returns an array of StyleRun[] groups, each group = one sentence.
 */
function splitRunsBySentence(runs: StyleRun[]): StyleRun[][] {
  const fullText = runs.map((r) => r.text).join("");
  const sentences = splitSentences(fullText);
  if (sentences.length <= 1) return [runs];

  // Build cumulative offsets for each run
  const offsets: number[] = [];
  let pos = 0;
  for (const r of runs) {
    offsets.push(pos);
    pos += r.text.length;
  }
  offsets.push(pos); // total length

  const result: StyleRun[][] = [];
  let sentIdx = 0;

  for (const sentence of sentences) {
    const start = fullText.indexOf(sentence, sentIdx);
    const end = start + sentence.length;
    sentIdx = end;

    const group: StyleRun[] = [];
    for (let i = 0; i < runs.length; i++) {
      const rStart = offsets[i];
      const rEnd = offsets[i + 1];
      // Skip runs entirely before this sentence
      if (rEnd <= start) continue;
      // Stop if we've passed the sentence
      if (rStart >= end) break;

      const overlapStart = Math.max(start, rStart);
      const overlapEnd = Math.min(end, rEnd);
      const sliceFrom = overlapStart - rStart;
      const sliceTo = overlapEnd - rStart;

      const clipped = runs[i].text.slice(sliceFrom, sliceTo);
      if (clipped) {
        group.push({ ...runs[i], text: clipped });
      }
    }
    if (group.length > 0) result.push(group);
  }

  return result;
}

/**
 * Hard-split StyleRun[] iteratively at word boundaries.
 * Returns all chunks, each ≤ maxChars.
 */
function hardSplitRuns(runs: StyleRun[], maxChars: number): StyleRun[][] {
  const fullText = runs.map((r) => r.text).join("");
  if (fullText.length <= maxChars) return [runs];

  // Use plain-text hardSplit to find all split positions
  const textChunks = hardSplit(fullText, maxChars);

  // Build cumulative run offsets
  const offsets: number[] = [];
  let pos = 0;
  for (const r of runs) {
    offsets.push(pos);
    pos += r.text.length;
  }
  offsets.push(pos);

  // Map each text chunk back to runs
  const result: StyleRun[][] = [];
  let charPos = 0;

  for (const chunk of textChunks) {
    const start = charPos;
    const end = start + chunk.length;
    charPos = end;

    const group: StyleRun[] = [];
    for (let i = 0; i < runs.length; i++) {
      const rStart = offsets[i];
      const rEnd = offsets[i + 1];
      if (rEnd <= start) continue;
      if (rStart >= end) break;

      const from = Math.max(start, rStart);
      const to = Math.min(end, rEnd);
      const clipped = runs[i].text.slice(from - rStart, to - rStart);
      if (clipped) group.push({ ...runs[i], text: clipped });
    }
    if (group.length > 0) result.push(group);
  }

  return result;
}

/**
 * Append incoming runs to buffer runs, merging adjacent same-style runs.
 * Prepends a space to the incoming data.
 */
function appendRuns(buffer: StyleRun[], incoming: StyleRun[]): void {
  if (incoming.length === 0) return;

  // Prepend space to first incoming run
  const first = { ...incoming[0], text: " " + incoming[0].text };
  const rest = incoming.slice(1);

  if (buffer.length === 0) {
    // Trim leading space on first append
    first.text = first.text.trimStart();
    buffer.push(first, ...rest);
    return;
  }

  // Try merging last buffer run with prepended first incoming run
  const last = buffer[buffer.length - 1];
  if (last.bold === first.bold && last.italic === first.italic) {
    buffer[buffer.length - 1] = { ...last, text: last.text + first.text };
  } else {
    buffer.push(first);
  }
  buffer.push(...rest);
}

// ─── Chunk book (run-aware) ─────────────────────────────────────

/**
 * Group sentences into chunks respecting min/max character bounds.
 * Bold/italic formatting from runs is preserved through splits and merges.
 */
export function chunkBook(book: ParsedBook, config: ChunkConfig): Block[] {
  const result: Block[] = [];

  for (const chapter of book.chapters) {
    if (config.includeChapterHeaders) {
      result.push({
        type: "text",
        id: `ch-${chapter.index}`,
        content: `── ${chapter.title} ──`,
        runs: [{ text: `── ${chapter.title} ──`, bold: false, italic: false }],
        charCount: chapter.title.length + HEADER_WRAP_LEN,
        chapterIndex: chapter.index,
        position: -1,
      });
    }

    let pending: TextBlock[] = [];

    for (const block of chapter.blocks) {
      if (block.type === "image") {
        result.push(...pending);
        pending = [];
        result.push(block);
        continue;
      }

      // Split runs into sentence groups
      const sentenceGroups = splitRunsBySentence(block.runs);

      let bufferRuns: StyleRun[] = [];
      let bufferText = "";
      let blockCount = 0;

      const flushBuffer = () => {
        const norm = normalizeRuns(bufferRuns);
        const trimmed = norm
          .map((r) => r.text)
          .join("")
          .trim();
        if (!trimmed) return;
        pending.push({
          type: "text",
          id: `c${chapter.index}-${block.position}-${blockCount++}`,
          content: trimmed,
          runs: norm,
          charCount: trimmed.length,
          chapterIndex: chapter.index,
          position: block.position,
        });
        bufferRuns = [];
        bufferText = "";
      };

      for (const group of sentenceGroups) {
        const groupText = group.map((r) => r.text).join("");

        // Hard-split oversize groups at word boundaries
        if (groupText.length > config.maxChars) {
          const parts = hardSplitRuns(group, config.maxChars);
          for (const part of parts) {
            const partText = part.map((r) => r.text).join("");
            // Same overflow check as regular sentence groups
            if (
              bufferText.length + partText.length + (bufferText ? 1 : 0) > config.maxChars &&
              bufferRuns.length > 0
            ) {
              flushBuffer();
            }
            appendRuns(bufferRuns, part);
            bufferText += (bufferText ? " " : "") + partText;
          }
          continue;
        }

        // Check if adding this group would exceed maxChars
        const wouldExceed =
          bufferText.length + groupText.length + (bufferText ? 1 : 0) > config.maxChars;

        if (wouldExceed && bufferRuns.length > 0) {
          flushBuffer();
        }

        appendRuns(bufferRuns, group);
        bufferText += (bufferText ? " " : "") + groupText;
      }

      // Flush remainder
      if (bufferText.length >= config.minChars) {
        flushBuffer();
      } else if (pending.length > 0 && bufferRuns.length > 0) {
        // Merge small tail into last pending block (if within maxChars)
        const last = pending[pending.length - 1];
        const merged = last.content + " " + bufferText;
        if (merged.length <= config.maxChars) {
          last.content = merged;
          last.charCount = merged.length;
          // Append runs — try merging last run first
          const lastRun = last.runs[last.runs.length - 1];
          const firstBuf = bufferRuns[0];
          if (lastRun.bold === firstBuf.bold && lastRun.italic === firstBuf.italic) {
            lastRun.text += " " + firstBuf.text;
            last.runs.push(...bufferRuns.slice(1));
          } else {
            last.runs.push({ text: " ", bold: false, italic: false }, ...bufferRuns);
          }
        } else {
          flushBuffer();
        }
      } else if (bufferRuns.length > 0) {
        flushBuffer();
      }
    }

    result.push(...pending);
  }

  return result;
}
