import { parseHTML } from "linkedom";
import type { RawBlock, BlockExtractor } from "./types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
// linkedom returns mock DOM nodes that duck-type to a simple shape.
// A precise type adds noise without value here.
type DomNode = any;

/**
 * DOM-walking block extractor.
 *
 * Walks the parsed XHTML body tree and extracts interleaved
 * text + image segments. Text is flushed at each block-level
 * element boundary (<p>, <div>, <h1-6>, etc.) and at <img> tags.
 *
 * Handles:
 *  - Inline <img> tags (flushes text before, emits image block)
 *  - Block elements wrapping a single image (treats as image block)
 *  - <br> and <hr> as segment boundaries
 *  - Script/style/noscript content stripped
 */
export class DomWalkerBlockExtractor implements BlockExtractor {
  readonly name = "dom-walker";

  private static BLOCK_TAGS = new Set([
    "p",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "li",
    "section",
    "figure",
    "td",
    "th",
    "pre",
  ]);

  private static SKIP_TAGS = new Set(["script", "style", "noscript", "title", "meta", "link"]);

  extract(html: string): RawBlock[] {
    const { document } = parseHTML(html);
    const body = document.querySelector("body");
    if (!body) return [];

    const blocks: RawBlock[] = [];
    const buf: string[] = [];

    const flush = () => {
      const t = buf.join(" ").replace(/\s+/g, " ").trim();
      if (t) blocks.push({ type: "text", content: t });
      buf.length = 0;
    };

    const isSingleImageWrapper = (n: DomNode): boolean => {
      const kids = n.childNodes ?? [];
      const nonText = kids.filter(
        (k: DomNode) =>
          k.nodeType === 1 &&
          !DomWalkerBlockExtractor.SKIP_TAGS.has((k.tagName || "").toLowerCase()),
      );
      return nonText.length === 1 && nonText[0]?.tagName?.toLowerCase() === "img";
    };

    const walk = (n: DomNode | null, _insideBlock: boolean) => {
      if (!n) return;

      if (n.nodeType === 3) {
        const t = (n.textContent || "").trim();
        if (t) buf.push(t);
        return;
      }

      if (n.nodeType !== 1) return;

      const tag = (n.tagName || "").toLowerCase();

      if (DomWalkerBlockExtractor.SKIP_TAGS.has(tag)) return;

      if (tag === "br") {
        if (buf.length > 0) buf.push(" ");
        return;
      }

      if (tag === "hr") {
        flush();
        return;
      }

      if (tag === "img") {
        flush();
        const src = n.getAttribute?.("src") || "";
        blocks.push({ type: "image", content: src });
        return;
      }

      const isBlock = DomWalkerBlockExtractor.BLOCK_TAGS.has(tag);

      if (isBlock && buf.length > 0 && !isSingleImageWrapper(n)) {
        flush();
      }

      for (const c of n.childNodes ?? []) {
        walk(c, isBlock);
      }

      if (isBlock) flush();
    };

    walk(body, false);
    flush();

    return blocks;
  }
}
