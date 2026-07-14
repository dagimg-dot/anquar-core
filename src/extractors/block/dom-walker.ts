import { parseHTML } from "linkedom";
import type { StyleRun } from "../../types.ts";
import type { RawBlock, BlockExtractor, StyleMapping } from "./types.ts";
import { parseCssStyles } from "../../utils/css.ts";

/**
 * Minimal node shape used by the DOM walker.
 * linkedom returns objects that duck-type to this interface —
 * using DOM's built-in types would create incompatibilities.
 */
interface WalkNode {
  nodeType: number;
  tagName?: string;
  textContent?: string | null;
  childNodes?: WalkNode[];
  getAttribute?(name: string): string | null;
}

/** Merge adjacent runs with identical style flags. */
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
 * DOM-walking block extractor with bold/italic tracking.
 *
 * Walks the parsed XHTML body tree and extracts interleaved
 * text + image segments. Text is emitted as StyleRun[] with
 * computed bold/italic flags from:
 *   1. Semantic HTML tags (<strong>, <b>, <em>, <i>)
 *   2. Inline style attributes (font-weight, font-style)
 *   3. CSS class names resolved against a pre-parsed map
 *
 * Handles nested/inherited styling — style flags propagate
 * through the DOM tree via the recursive walker.
 */
export class DomWalkerBlockExtractor implements BlockExtractor {
  readonly name = "dom-walker";

  private static BOLD_TAGS = new Set(["b", "strong"]);
  private static ITALIC_TAGS = new Set(["i", "em"]);

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

  extract(html: string, externalCss?: Map<string, StyleMapping>): RawBlock[] {
    let doc: ReturnType<typeof parseHTML>["document"];
    try {
      doc = parseHTML(html).document;
    } catch {
      return [];
    }
    const body = doc.querySelector("body");
    if (!body) return [];

    // Build CSS class map: merge external (from parser) with inline <style>
    const cssMap = new Map(externalCss);
    for (const st of doc.querySelectorAll("style")) {
      const parsed = parseCssStyles(st.textContent || "");
      for (const [k, v] of parsed) {
        if (!cssMap.has(k)) cssMap.set(k, v); // inline wins over external
      }
    }

    const blocks: RawBlock[] = [];
    const runs: StyleRun[] = [];

    const flush = () => {
      if (runs.length === 0) return;
      const norm = normalizeRuns(runs);
      const content = norm.map((r) => r.text).join("");
      if (content.trim()) {
        blocks.push({ type: "text", content, runs: norm });
      }
      runs.length = 0;
    };

    const isSingleImageWrapper = (n: WalkNode): boolean => {
      const kids = n.childNodes ?? [];
      const nonText = kids.filter(
        (k) =>
          k.nodeType === 1 &&
          !DomWalkerBlockExtractor.SKIP_TAGS.has((k.tagName || "").toLowerCase()),
      );
      return nonText.length === 1 && nonText[0]?.tagName?.toLowerCase() === "img";
    };

    const computeStyle = (n: WalkNode, inheritedBold: boolean, inheritedItalic: boolean) => {
      let bold = inheritedBold;
      let italic = inheritedItalic;
      const tag = (n.tagName || "").toLowerCase();

      if (DomWalkerBlockExtractor.BOLD_TAGS.has(tag)) bold = true;
      if (DomWalkerBlockExtractor.ITALIC_TAGS.has(tag)) italic = true;

      const styleAttr = n.getAttribute?.("style") || "";
      if (/\bfont-weight\s*:\s*bold\b/i.test(styleAttr)) bold = true;
      if (/\bfont-style\s*:\s*italic\b/i.test(styleAttr)) italic = true;

      const classAttr = n.getAttribute?.("class") || "";
      if (classAttr && cssMap.size > 0) {
        for (const cls of classAttr.split(/\s+/)) {
          const s = cssMap.get(cls);
          if (s) {
            if (s.bold) bold = true;
            if (s.italic) italic = true;
          }
        }
      }

      return { bold, italic };
    };

    const walk = (n: WalkNode | null, inheritedBold: boolean, inheritedItalic: boolean) => {
      if (!n) return;

      if (n.nodeType === 3) {
        const t = (n.textContent || "").trim();
        if (t) runs.push({ text: t, bold: inheritedBold, italic: inheritedItalic });
        return;
      }

      if (n.nodeType !== 1) return;

      const tag = (n.tagName || "").toLowerCase();
      if (DomWalkerBlockExtractor.SKIP_TAGS.has(tag)) return;

      if (tag === "br") {
        if (runs.length > 0) runs.push({ text: " ", bold: false, italic: false });
        return;
      }

      if (tag === "hr") {
        flush();
        return;
      }

      if (tag === "img") {
        flush();
        const src = n.getAttribute?.("src") || "";
        const alt = n.getAttribute?.("alt") || "";
        blocks.push({ type: "image", content: src, alt });
        return;
      }

      const isBlock = DomWalkerBlockExtractor.BLOCK_TAGS.has(tag);
      const { bold, italic } = computeStyle(n, inheritedBold, inheritedItalic);

      if (isBlock && runs.length > 0 && !isSingleImageWrapper(n)) {
        flush();
      }

      for (const c of n.childNodes ?? []) {
        walk(c, bold, italic);
      }

      if (isBlock) flush();
    };

    walk(body as unknown as WalkNode, false, false);
    flush();

    return blocks;
  }
}
