/** Decode common HTML entities found in EPUB content. */
export function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#821[67];/g, "'")
		.replace(/&#821[12];/g, "–")
		.replace(/&#821[23];/g, "—")
		.replace(/&#8230;/g, "…")
		.replace(/&#x201[89];/g, "'")
		.replace(/&#x201[34];/g, "–")
		.replace(/&#x2014;/g, "—")
		.replace(/&#x2026;/g, "…")
		.replace(/&#160;/g, " ")
		.replace(/&#x00A0;/g, " ");
}
