export interface ImageSize {
	width: number;
	height: number;
}

function u16be(b: Uint8Array, i: number): number {
	return (b[i] << 8) | b[i + 1];
}

function u16le(b: Uint8Array, i: number): number {
	return b[i] | (b[i + 1] << 8);
}

function u24le(b: Uint8Array, i: number): number {
	return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

function u32be(b: Uint8Array, i: number): number {
	return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function ascii(b: Uint8Array, i: number, length: number): string {
	return String.fromCharCode(...b.subarray(i, i + length));
}

function jpegSize(b: Uint8Array): ImageSize | null {
	let i = 2;
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) {
			i++;
			continue;
		}
		const marker = b[i + 1];
		const standalone =
			marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
		if (standalone) {
			i += 2;
			continue;
		}
		const isFrame =
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc;
		if (isFrame) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
		i += 2 + u16be(b, i + 2);
	}
	return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
	const chunk = ascii(b, 12, 4);
	if (chunk === "VP8 ") {
		return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
	}
	if (chunk === "VP8L") {
		const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	if (chunk === "VP8X") {
		return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
	}
	return null;
}

export function imageSize(b: Uint8Array): ImageSize | null {
	if (b.length < 30) return null;
	if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") {
		return { width: u32be(b, 16), height: u32be(b, 20) };
	}
	if (ascii(b, 0, 3) === "GIF") {
		return { width: u16le(b, 6), height: u16le(b, 8) };
	}
	if (b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
	if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
		return webpSize(b);
	}
	return null;
}
