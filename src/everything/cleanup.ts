import { parseHTML } from "linkedom";

const BOILERPLATE =
	/subscribe|newsletter|sign\s?up|follow me|share on|tweet|thanks for reading|type your email|get\s.*posts|never miss|email.*address|join.*newsletter/i;

/** Wrap an HTML fragment in a full document so linkedom body populates. */
export function asFullHtml(html: string): string {
	return `<!DOCTYPE html><html><body>${html}</body></html>`;
}

/**
 * Remove non-content elements from Readability's HTML output:
 * - `<form>` and `<button>` elements (subscription forms)
 * - Short elements (< 200 chars) whose text matches boilerplate patterns
 */
export function cleanupArticle(html: string): string {
	// Wrap in a full document so linkedom populates body correctly.
	let doc: ReturnType<typeof parseHTML>["document"];
	try {
		doc = parseHTML(asFullHtml(html)).document;
	} catch {
		return html;
	}

	const body = doc.body;
	if (!body) return html;

	// Collect targets first, then remove (avoid live collection mutation)
	const targets: Element[] = [];

	for (const el of body.querySelectorAll("*")) {
		const tag = (el.tagName || "").toLowerCase();

		if (tag === "form" || tag === "button") {
			targets.push(el as Element);
			continue;
		}

		const text = (el.textContent || "").trim();
		if (text.length < 200 && BOILERPLATE.test(text)) {
			targets.push(el as Element);
		}
	}

	for (const el of targets) {
		el.remove();
	}

	// Serialize remaining content — get innerHTML of the readability container
	const page = body.firstElementChild;
	return page ? page.innerHTML || page.textContent || "" : body.innerHTML || "";
}
