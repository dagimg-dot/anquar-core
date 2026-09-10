import type { StyleMapping } from "../types.ts";

/**
 * Extract bold/italic class mappings from CSS.
 * Handles compound selectors by extracting the last class before `{`,
 * and comma-separated groups by iterating each sub-selector.
 * Generic names (single-letter, "a", "b", "c", "e", "x") are skipped
 * to prevent false positives from broad selectors.
 */
export function parseCssStyles(css: string): Map<string, StyleMapping> {
	const map = new Map<string, StyleMapping>();

	for (const rule of css.split("}")) {
		const braceIdx = rule.indexOf("{");
		if (braceIdx === -1) continue;

		const selector = rule.slice(0, braceIdx).trim();
		const body = rule.slice(braceIdx + 1).trim();
		if (!selector || !body) continue;

		const bold = /\bfont-weight\s*:\s*bold\b/i.test(body);
		const italic = /\bfont-style\s*:\s*italic\b/i.test(body);
		if (!bold && !italic) continue;

		for (const sub of selector.split(",")) {
			const classes = [...sub.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
			if (classes.length === 0) continue;
			const cls = classes[classes.length - 1][1];
			if (cls.length <= 1) continue;
			if (cls.length <= 2 && /^[a-ex]$/i.test(cls)) continue;
			map.set(cls, { bold, italic });
		}
	}

	return map;
}
