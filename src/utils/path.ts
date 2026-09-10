/**
 * Normalize an EPUB-internal path to an OPF-relative key
 * that matches the format of `item.href` in the manifest.
 *
 * Strips OPF dir prefix, ./ prefix, and fragment/anchor.
 * Input is a full resolved ZIP path like "OEBPS/html/ch1.xhtml"
 * or a relative path like "./html/ch1.xhtml#anchor".
 *
 * Returns: "html/ch1.xhtml"
 */
export function normalizeTitleKey(opfDir: string, fullPath: string): string {
	let p = fullPath;
	// Strip anchor/fragment
	const hash = p.indexOf("#");
	if (hash !== -1) p = p.slice(0, hash);
	// Strip opfDir prefix
	if (opfDir && p.startsWith(opfDir)) {
		p = p.slice(opfDir.length);
	}
	// Strip ./ prefix
	if (p.startsWith("./")) p = p.slice(2);
	return p;
}
