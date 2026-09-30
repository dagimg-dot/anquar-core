const TOP_OF_FILE_CHARS = 300;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textBefore(html: string, fragment: string): number {
	const attr = new RegExp(
		`\\b(?:id|name)\\s*=\\s*["']${escapeRegex(fragment)}["']`,
	);
	const at = html.search(attr);
	if (at < 0) return 0;
	const tagStart = html.lastIndexOf("<", at);
	const bodyStart = Math.max(0, html.search(/<body\b/i));
	return html
		.slice(bodyStart, tagStart)
		.replace(/<[^>]*>/g, "")
		.replace(/&[#\w]+;/g, "x")
		.replace(/\s+/g, "").length;
}

export function atTopOfFile(
	html: string | undefined,
	fragment: string,
): boolean {
	if (!html || !fragment) return true;
	return textBefore(html, fragment) <= TOP_OF_FILE_CHARS;
}
