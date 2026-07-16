import type { ParsedBook, Block, TextBlock, StyleRun, ChunkConfig } from "./types.ts";

const HEADER_WRAP_LEN = "── ".length + " ──".length;

// ─── Sentence splitting (works on plain text) ───────────────────

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

// ─── Hard split (works on plain text) ───────────────────────────

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

// ─── Run-aware operations ──────────────────────────────────────

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

function splitRunsBySentence(runs: StyleRun[]): StyleRun[][] {
  const fullText = runs.map((r) => r.text).join("");
  const sentences = splitSentences(fullText);
  if (sentences.length <= 1) return [runs];

  const offsets: number[] = [];
  let pos = 0;
  for (const r of runs) {
    offsets.push(pos);
    pos += r.text.length;
  }
  offsets.push(pos);

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

function hardSplitRuns(runs: StyleRun[], maxChars: number): StyleRun[][] {
  const fullText = runs.map((r) => r.text).join("");
  if (fullText.length <= maxChars) return [runs];

  const textChunks = hardSplit(fullText, maxChars);

  const offsets: number[] = [];
  let pos = 0;
  for (const r of runs) {
    offsets.push(pos);
    pos += r.text.length;
  }
  offsets.push(pos);

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

function appendRuns(buffer: StyleRun[], incoming: StyleRun[]): void {
  if (incoming.length === 0) return;

  const first = { ...incoming[0], text: " " + incoming[0].text };
  const rest = incoming.slice(1);

  if (buffer.length === 0) {
    first.text = first.text.trimStart();
    buffer.push(first, ...rest);
    return;
  }

  const last = buffer[buffer.length - 1];
  if (last.bold === first.bold && last.italic === first.italic) {
    buffer[buffer.length - 1] = { ...last, text: last.text + first.text };
  } else {
    buffer.push(first);
  }
  buffer.push(...rest);
}

// ─── Core chunker: Block[] → Block[] (no chapters) ─────────────

/**
 * Chunk a flat list of blocks into smaller blocks respecting min/max
 * character bounds.  Preserves bold/italic through splits and merges.
 *
 * @param blocks — the blocks to chunk (typically from one chapter or article)
 * @param chapterIndex — used for id generation
 * @param config — min/max character bounds
 */
export function chunkBlocks(blocks: Block[], chapterIndex: number, config: ChunkConfig): Block[] {
  const result: Block[] = [];
  let pending: TextBlock[] = [];

  for (const block of blocks) {
    if (block.type === "image") {
      result.push(...pending);
      pending = [];
      result.push(block);
      continue;
    }

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
        id: `c${chapterIndex}-${block.position}-${blockCount++}`,
        content: trimmed,
        runs: norm,
        charCount: trimmed.length,
        chapterIndex,
        position: block.position,
      });
      bufferRuns = [];
      bufferText = "";
    };

    for (const group of sentenceGroups) {
      const groupText = group.map((r) => r.text).join("");

      if (groupText.length > config.maxChars) {
        const parts = hardSplitRuns(group, config.maxChars);
        for (const part of parts) {
          const partText = part.map((r) => r.text).join("");
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

      const wouldExceed =
        bufferText.length + groupText.length + (bufferText ? 1 : 0) > config.maxChars;

      if (wouldExceed && bufferRuns.length > 0) {
        flushBuffer();
      }

      appendRuns(bufferRuns, group);
      bufferText += (bufferText ? " " : "") + groupText;
    }

    if (bufferText.length >= config.minChars) {
      flushBuffer();
    } else if (pending.length > 0 && bufferRuns.length > 0) {
      const last = pending[pending.length - 1];
      const merged = last.content + " " + bufferText;
      if (merged.length <= config.maxChars) {
        last.content = merged;
        last.charCount = merged.length;
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
  return result;
}

// ─── Book wrapper: iterates chapters ─────────────────────────────

/**
 * Chunk an entire parsed book chapter by chapter.
 * Adds chapter header blocks when includeChapterHeaders is enabled.
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

    result.push(...chunkBlocks(chapter.blocks, chapter.index, config));
  }

  return result;
}
