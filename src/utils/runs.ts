import type { StyleRun } from "../types.ts";

export const LINE_BREAK = "\u2028";

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

export function collapseRuns(runs: StyleRun[]): StyleRun[] {
	const chars: { ch: string; style: StyleRun }[] = [];
	const tail = () => chars[chars.length - 1]?.ch;

	for (const run of runs) {
		for (const ch of run.text) {
			if (ch === LINE_BREAK || ch === "\n") {
				if (tail() === " ") chars.pop();
				if (chars.length === 0 || tail() === "\n") continue;
				chars.push({ ch: "\n", style: run });
			} else if (/\s/.test(ch)) {
				if (chars.length === 0 || tail() === " " || tail() === "\n") continue;
				chars.push({ ch: " ", style: run });
			} else {
				chars.push({ ch, style: run });
			}
		}
	}
	while (tail() === " " || tail() === "\n") chars.pop();

	const out: StyleRun[] = [];
	for (const { ch, style } of chars) {
		const last = out[out.length - 1];
		if (last && last.bold === style.bold && last.italic === style.italic) {
			last.text += ch;
		} else {
			out.push({ text: ch, bold: style.bold, italic: style.italic });
		}
	}
	return out;
}
