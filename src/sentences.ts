const SENTENCE_CLOSERS = new Set([..."\"'”’»›)]」』）"]);

const SENTENCE_OPENERS = new Set([..."\"'“‘«‹([「『（¡¿"]);

const IDEOGRAPHIC_STOP = /[。！？]/;

const ABBREVIATIONS = new Set([
	"mr",
	"mrs",
	"ms",
	"dr",
	"prof",
	"st",
	"jr",
	"sr",
	"capt",
	"lt",
	"col",
	"gen",
	"sgt",
	"rev",
	"fr",
	"hon",
	"gov",
	"sen",
	"rep",
	"pres",
	"mt",
	"vs",
	"e.g",
	"i.e",
	"cf",
	"viz",
	"ca",
	"al",
	"fig",
	"figs",
	"vol",
	"vols",
	"ch",
	"chap",
	"p",
	"pp",
	"ed",
	"eds",
	"no",
	"op",
	"ibid",
]);

function isSpace(ch: string | undefined): boolean {
	return ch !== undefined && /\s/.test(ch);
}

function wordBefore(text: string, end: number): string {
	let start = end;
	while (start > 0 && /[\p{L}.]/u.test(text[start - 1])) start--;
	return text.slice(start, end);
}

function isInitial(word: string): boolean {
	return /^\p{Lu}$/u.test(word);
}

function endsAbbreviation(text: string, dot: number): boolean {
	const word = wordBefore(text, dot);
	if (!word) return false;
	return isInitial(word) || ABBREVIATIONS.has(word.toLowerCase());
}

/** Offsets where each sentence after the first begins. */
export function sentenceStarts(text: string): number[] {
	const starts: number[] = [];
	const terminal = /[.!?…]+|[。！？]/g;

	for (let m = terminal.exec(text); m; m = terminal.exec(text)) {
		let j = m.index + m[0].length;
		while (j < text.length && SENTENCE_CLOSERS.has(text[j])) j++;

		if (IDEOGRAPHIC_STOP.test(m[0])) {
			if (j < text.length && !isSpace(text[j])) starts.push(j);
			continue;
		}
		if (!isSpace(text[j])) continue;

		let k = j;
		while (isSpace(text[k])) k++;
		let first = k;
		while (first < text.length && SENTENCE_OPENERS.has(text[first])) first++;
		if (first >= text.length || !/\p{Lu}/u.test(text[first])) continue;

		if (m[0] === "." && endsAbbreviation(text, m.index)) continue;
		starts.push(k);
	}

	return starts;
}

export function splitSentences(text: string): string[] {
	const bounds = [0, ...sentenceStarts(text), text.length];
	const out: string[] = [];
	for (let i = 0; i < bounds.length - 1; i++) {
		const sentence = text.slice(bounds[i], bounds[i + 1]).trim();
		if (sentence) out.push(sentence);
	}
	return out;
}

export function hardSplit(text: string, maxChars: number): string[] {
	if (text.length <= maxChars) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > maxChars) {
		const slice = remaining.slice(0, maxChars);
		const lastSpace = slice.lastIndexOf(" ");

		if (lastSpace <= 0) {
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
