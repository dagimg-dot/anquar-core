import type { StyleRun } from "../types.ts";

/** Merge adjacent runs with identical style. */
export function normalizeRuns(runs: StyleRun[]): StyleRun[] {
	if (runs.length <= 1) return runs.map((r) => ({ ...r }));
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
