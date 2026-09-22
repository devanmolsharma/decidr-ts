/**
 * Real agent interaction: a Playwright-driven browser that navigates from
 * one real Wikipedia article toward a target article, purely by asking
 * decidr "which of these real links on the page gets closest to the goal"
 * at each hop -- the same pattern behind Jev's flight-booking demo (a
 * chain of typed decisions driving a real browser to a real outcome), just
 * against a public site that needs no login or purchase.
 *
 * Each hop's decision -- and its full probability distribution over every
 * real link considered -- is printed, and a screenshot of the page is
 * saved after each hop. Run with:
 *
 *   npx tsx examples/wikipedia-navigator/run.mts
 *
 * Needs `npx playwright install chromium` once, and either a local Ollama
 * or OPENAI_API_KEY (pass --openai).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { Client, MAX_BRANCHES_PER_LEVEL, OllamaBackend, OpenAIBackend } from "../../src/index.js";

const useOpenAI = process.argv.includes("--openai");
const model = useOpenAI ? "gpt-4o" : "qwen3.5:4b";
const backend = useOpenAI ? new OpenAIBackend({ apiKey: process.env.OPENAI_API_KEY }) : new OllamaBackend();
const client = new Client(model, { backend });

const START = "https://en.wikipedia.org/wiki/Chess";
const TARGET = "Logic";
const MAX_HOPS = 6;

const outDir = new URL("./screenshots", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

function slugify(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(START, { waitUntil: "networkidle" });

console.log(`Wikipedia navigator: ${START} -> an article about "${TARGET}"\n`);
console.log(`model: ${model}\n`);

let hop = 0;
let arrived = false;
const visitedTitles = new Set<string>();

while (hop < MAX_HOPS && !arrived) {
  hop++;
  const title = (await page.title()).replace(/ - Wikipedia$/, "");
  visitedTitles.add(title);
  console.log(`--- hop ${hop}: on "${title}" ---`);

  await page.screenshot({ path: `${outDir}/hop-${hop}-${slugify(title)}.png` });

  if (title.toLowerCase().includes(TARGET.toLowerCase())) {
    console.log(`Arrived at an article about "${TARGET}".`);
    arrived = true;
    break;
  }

  // Collect real, visible, in-article links -- deduplicated by article
  // title, capped to a reasonable race size. Wikipedia's current skin
  // renders fully-qualified hrefs (https://en.wikipedia.org/wiki/X), not
  // relative /wiki/X ones, so match on the /wiki/ path instead of a prefix.
  const links = await page.$$eval("#mw-content-text a[href*='/wiki/']", (as) =>
    as
      .filter((a) => (a as HTMLElement).offsetParent !== null)
      .map((a) => {
        const href = (a as HTMLAnchorElement).href;
        const path = new URL(href).pathname; // "/wiki/Some_Title"
        return {
          title: decodeURIComponent(path.replace("/wiki/", "")).replace(/_/g, " "),
          href,
        };
      })
      .filter((l) => l.title && !l.title.includes(":")),
  );

  const seen = new Set<string>();
  // Drop anything already visited this run first, then dedupe and cap --
  // otherwise a heavily cross-linked topic page (chess pieces linking to
  // each other) can keep re-offering the same handful of already-seen
  // articles and never surface a genuinely new option.
  const uniqueLinks = links
    .filter((l) => !visitedTitles.has(l.title))
    .filter((l) => (seen.has(l.title) ? false : (seen.add(l.title), true)))
    .slice(0, MAX_BRANCHES_PER_LEVEL);

  if (uniqueLinks.length === 0) {
    console.log("No usable links found on this page -- stopping.");
    break;
  }

  const options = uniqueLinks.map((l, i) => {
    const prefix = `link_${i}_`;
    const id = (prefix + slugify(l.title)).slice(0, 40).replace(/_+$/, "");
    return { id, description: l.title };
  });

  const decision = await client.decide({
    id: `hop-${hop}`,
    state: `Currently on the Wikipedia article "${title}". The goal is to reach an article about "${TARGET}" by following links, in as few clicks as possible.`,
    question: `Which linked article should be clicked next to get closer to "${TARGET}"?`,
    options,
  });

  console.log("candidates:");
  for (const [id, p] of [...decision.probabilities].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    const opt = options.find((o) => o.id === id)!;
    console.log(`  ${(p * 100).toFixed(1).padStart(5)}%  ${opt.description}`);
  }

  const chosen = options.find((o) => o.id === decision.choice)!;
  const chosenLink = uniqueLinks.find((l) => l.title === chosen.description)!;
  console.log(`-> clicking "${chosenLink.title}"\n`);

  await page.goto(chosenLink.href, { waitUntil: "networkidle" });
}

if (!arrived) {
  console.log(`Did not reach "${TARGET}" within ${MAX_HOPS} hops -- ended on "${await page.title()}".`);
}

await browser.close();
console.log(`\nScreenshots saved to ${outDir}`);
