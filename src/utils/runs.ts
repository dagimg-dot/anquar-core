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

export function runsText(runs: StyleRun[]): string {
	return runs.map((r) => r.text).join("");
}

/**
 * Squeeze whitespace runs to single spaces and trim both ends of the
 * sequence, so markup indentation never reaches the reader.
 */
export function collapseRuns(runs: StyleRun[]): StyleRun[] {
	const out: StyleRun[] = [];
	let atBoundary = true;

	for (const run of runs) {
		let text = run.text.replace(/\s+/g, " ");
		if (atBoundary && text.startsWith(" ")) text = text.slice(1);
		if (!text) continue;
		atBoundary = text.endsWith(" ");
		out.push({ ...run, text });
	}

	while (out.length > 0) {
		const last = out[out.length - 1];
		const trimmed = last.text.replace(/\s+$/, "");
		if (trimmed) {
			last.text = trimmed;
			break;
		}
		out.pop();
	}

	return normalizeRuns(out);
}
