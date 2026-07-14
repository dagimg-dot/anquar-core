import type { StyleMapping } from "../extractors/block/types.ts";

/**
 * Parse a CSS string for class → style mappings relevant to bold/italic.
 *
 * Handles:
 *   - Simple selectors:           `.bold { font-weight: bold }`
 *   - Tag-and-class:              `span.author { font-style: italic }`
 *   - Descendant (last class):    `.titlepage .author { font-style: italic }`
 *   - Multi-class  (last class):  `.note.emphasis { font-weight: bold }`
 *   - Comma groups:               `.bold, .strong { font-weight: bold }`
 *   - Pseudo/attribute:           `.class:hover { ... }`, `.class[attr] { ... }`
 *
 * Skip generic class names (single-letter or very common short names)
 * to avoid false positives from broad selectors like `.a { ... }`.
 */
export function parseCssStyles(css: string): Map<string, StyleMapping> {
  const map = new Map<string, StyleMapping>();

  // Split by `}` to get each rule
  for (const rule of css.split("}")) {
    const braceIdx = rule.indexOf("{");
    if (braceIdx === -1) continue;

    const selector = rule.slice(0, braceIdx).trim();
    const body = rule.slice(braceIdx + 1).trim();
    if (!selector || !body) continue;

    const bold = /\bfont-weight\s*:\s*bold\b/i.test(body);
    const italic = /\bfont-style\s*:\s*italic\b/i.test(body);
    if (!bold && !italic) continue;

    // Extract the last class name from each comma-separated sub-selector
    for (const sub of selector.split(",")) {
      const classes = [...sub.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
      if (classes.length === 0) continue;

      // The last class before `{` is the target element's class
      const cls = classes[classes.length - 1][1];
      // Skip generic names (length <= 2) to prevent false positives
      if (cls.length <= 2 && /^[a-ex]$/i.test(cls)) continue;

      // Short class names need to be descriptive, skip single letters
      if (cls.length <= 1) continue;

      map.set(cls, { bold, italic });
    }
  }

  return map;
}
