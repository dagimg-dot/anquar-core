#!/usr/bin/env bun

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const samplesDir = join(__dirname, "sample_epubs");
const sources: Record<string, string> = await Bun.file(
	join(__dirname, "sample-sources.json"),
).json();

mkdirSync(samplesDir, { recursive: true });

for (const [name, url] of Object.entries(sources)) {
	const target = join(samplesDir, name);
	if (existsSync(target)) continue;

	const response = await fetch(url);
	if (!response.ok) {
		console.error(`✗ ${name}: HTTP ${response.status}`);
		continue;
	}
	await Bun.write(target, await response.arrayBuffer());
	console.log(`✓ ${name}`);
	await Bun.sleep(2000);
}
