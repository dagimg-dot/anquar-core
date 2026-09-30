#!/usr/bin/env bun

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "src", "index.ts");
const samplesDir = join(__dirname, "sample_epubs");

const files = readdirSync(samplesDir)
	.filter((f: string) => f.endsWith(".epub"))
	.sort();

console.log(
	`${"File".padEnd(42)} ${"Size".padEnd(8)} ${"Time".padEnd(8)} ${"Chaps".padEnd(6)} ${"Cards".padEnd(7)}`,
);
console.log("─".repeat(75));

let totalTime = 0;
let totalCards = 0;

for (const file of files) {
	const path = join(samplesDir, file);
	const sizeBytes = statSync(path).size;
	const size = `${(sizeBytes / 1024 / 1024).toFixed(1)}M`;

	const t0 = performance.now();
	const proc = Bun.spawnSync(["bun", "run", CLI, "parse", path, "--stats"], {
		env: { ...process.env },
	});
	const elapsed = (performance.now() - t0).toFixed(0);

	const _stdout = proc.stdout.toString();
	const stderr = proc.stderr.toString();

	const chapMatch = stderr.match(/(\d+) chapters? → (\d+) cards?/);
	const chaps = chapMatch?.[1] ?? "?";
	const cards = parseInt(chapMatch?.[2] ?? "0", 10);

	totalTime += parseInt(elapsed, 10);
	totalCards += cards;

	const status = proc.exitCode === 0 ? " " : "⚠";
	console.log(
		`${status} ${file.padEnd(40)} ${size.padEnd(8)} ${elapsed.padEnd(8)} ${String(chaps).padEnd(6)} ${String(cards).padEnd(7)}`,
	);

	if (proc.exitCode !== 0) {
		console.error(`  └─ exit ${proc.exitCode}: ${stderr.slice(0, 200)}`);
	}
}

console.log("─".repeat(75));
const numFiles = files.length;
console.log(`  ${numFiles} files, ${totalTime}ms total, ${totalCards} cards`);
console.log(`  Avg: ${(totalTime / numFiles).toFixed(0)}ms per file`);
console.log(`  Cards/sec: ${(totalCards / (totalTime / 1000)).toFixed(0)}`);
