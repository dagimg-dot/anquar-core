# anquar-core

The engine behind Anquar, a reader that turns books into a vertical feed. It parses an EPUB into a flat stream of blocks and lays them out as cards that each fill one screen.

- **Parse:** chapters come back as `text`, `heading`, `list`, `image` and `break` blocks, with inline bold and italic kept as style runs. The book's apparatus (cover, title and copyright pages, contents, praise, notes, index) is left out and listed in `omitted`; dedications, epigraphs and prefaces are marked `frontMatter`.
- **Paginate:** `paginate` packs blocks into cards from two numbers you measure on the device: how many characters fit on a line and how many lines fit on a card. Paragraphs stay whole where they fit, a paragraph splits at a sentence where a card would otherwise be mostly empty, and a heading is never left at the bottom of a card.
- **Runs anywhere:** the parser takes a zip you hand it, so it works in a browser or a worker with JSZip and in Node with AdmZip.

```sh
npm install anquar-core
```

## In the browser

Bring your own JSZip:

```ts
import JSZip from "jszip";
import { EpubZip, paginate, parseEpubFromZip } from "anquar-core";

const zip = await EpubZip.fromJSZip(await JSZip.loadAsync(file));
const book = await parseEpubFromZip(zip, undefined, file.name);

const cards = paginate(book.chapters, { charsPerLine: 40, linesPerCard: 22 });
// cards[0] → { id: "c0-0", chapterIndex: 0, blocks: [...] }
```

Card ids name a place in the book (`c3-12` is chapter 3 from block 12, `c3-12@480` the same block from character 480), so a reader can keep its place when the layout changes and the book is paginated again.

## In Node

```ts
import { PHONE_LAYOUT, paginate } from "anquar-core";
import { parseEpub } from "anquar-core/node";

const book = await parseEpub("moby-dick.epub");
console.log(book.title, book.author, book.chapters.length);

const cards = paginate(book.chapters, PHONE_LAYOUT);
```

## Measuring a layout

`CardLayout` is `{ charsPerLine, linesPerCard }`. In a browser, render a long sample paragraph in the card's own type, count the lines it wraps to, and divide its length by them; divide the card's content height by one line's height for `linesPerCard`. Measure again whenever the screen, type size, line height or margins change, and paginate again.

## Paging part of a book

A long book doesn't need paginating all at once. `carriesIntoNext(chapter)` says whether a chapter's last card can run into the next chapter (only a closing heading, such as a part title, does). Paginating a run of chapters that starts after one that doesn't carry gives exactly the cards the whole book would.
