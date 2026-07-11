import type { ParsedBook, Block, TextBlock, ChunkConfig } from "./types.ts";

const HEADER_WRAP_LEN = "── ".length + " ──".length;

/**
 * Split text into sentence-sized pieces using punctuation boundaries.
 *
 * Handles:
 *  - Standard `. ? !` terminators
 *  - Common abbreviations (Dr., Mr., Mrs., Ms., vs., etc., i.e., e.g.)
 *  - CJK punctuation (。！？)
 *  - Ellipsis (...) — NOT a sentence boundary
 *  - Quotes attached to punctuation ("Hello." → boundary after the quote)
 */
export function splitSentences(text: string): string[] {
  // Sentence-end regex:
  //   (?<=[.!?。！？])  — positive lookbehind for terminal punctuation
  //   (?=["'）」』\s]*)   — optional closing quotes / brackets
  //   (?=\s+|$)          — followed by whitespace or end of string
  //
  // The abbreviation lookbehind (negative) prevents splitting on:
  //   Dr. Mr. Mrs. Ms. St. vs. etc. i.e. e.g. dept. approx. ...
  const ABBREVIATIONS =
    /\b(?:Dr|Mr|Mrs|Ms|St|vs|etc|i\.e|e\.g|dept|approx|Jr|Sr|Prof|Capt|Lt|Col|Gen|Sgt|p\.|pp\.|vol|fig|al|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.$/i;

  const raw = text
    .replace(/\r\n/g, "\n")
    .replace(/\.\.\./g, "\u0000ELLIPSIS\u0000")
    .replace(/\n\n+/g, "\u0000PARA\u0000");

  // Insert a split marker at every sentence boundary
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

  // Heuristic merge: if a "sentence" doesn't end with terminal punct,
  // it was probably a false split — merge it with the next one.
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

/**
 * Break a string at the last word boundary before `maxChars`.
 * Never splits mid-word. Falls back to hard character limit
 * only if the string has no whitespace at all (single unbroken token).
 */
export function hardSplit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    const slice = remaining.slice(0, maxChars);
    const lastSpace = slice.lastIndexOf(" ");

    if (lastSpace === -1) {
      // No word boundary — single long token, hard break at limit
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

/**
 * Group sentences into chunks respecting min/max character bounds.
 * Images are always returned as standalone blocks.
 * Sentences that exceed maxChars are hard-split at word boundaries.
 */
export function chunkBook(book: ParsedBook, config: ChunkConfig): Block[] {
  const result: Block[] = [];

  for (const chapter of book.chapters) {
    if (config.includeChapterHeaders) {
      result.push({
        type: "text",
        id: `ch-${chapter.index}`,
        content: `── ${chapter.title} ──`,
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

      const sentences = splitSentences(block.content);

      let buffer = "";
      let blockCount = 0;

      for (const sentence of sentences) {
        // Hard-split oversize sentences at word boundaries
        const parts = hardSplit(sentence, config.maxChars);
        for (const part of parts) {
          if (buffer.length + part.length + 1 > config.maxChars && buffer.length > 0) {
            pending.push({
              type: "text",
              id: `c${chapter.index}-${block.position}-${blockCount++}`,
              content: buffer.trim(),
              charCount: buffer.trim().length,
              chapterIndex: chapter.index,
              position: block.position,
            });
            buffer = "";
          }

          buffer += (buffer ? " " : "") + part;
        }
      }

      if (buffer.length >= config.minChars) {
        pending.push({
          type: "text",
          id: `c${chapter.index}-${block.position}-${blockCount++}`,
          content: buffer.trim(),
          charCount: buffer.trim().length,
          chapterIndex: chapter.index,
          position: block.position,
        });
      } else if (pending.length > 0) {
        // Merge into last pending block only if it stays within bounds
        const last = pending[pending.length - 1];
        const merged = last.content + " " + buffer.trim();
        if (merged.length <= config.maxChars) {
          last.content = merged;
          last.charCount = merged.length;
        } else {
          pending.push({
            type: "text",
            id: `c${chapter.index}-${block.position}-${blockCount++}`,
            content: buffer.trim(),
            charCount: buffer.trim().length,
            chapterIndex: chapter.index,
            position: block.position,
          });
        }
      } else if (buffer.trim()) {
        // Only block in this paragraph — emit even if under minChars
        pending.push({
          type: "text",
          id: `c${chapter.index}-${block.position}-${blockCount++}`,
          content: buffer.trim(),
          charCount: buffer.trim().length,
          chapterIndex: chapter.index,
          position: block.position,
        });
      }
    }

    result.push(...pending);
  }

  return result;
}
