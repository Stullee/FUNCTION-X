// Renders the panel preview in headless Chromium and saves screenshots.
// Usage: node dev/screenshots.mjs <outDir>   (serve the repo root on :8765 first)
import { chromium } from "playwright";

const out = process.argv[2] || "shots";
const base = "http://localhost:8765/frontend/dev/index.html";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];

async function shot(name, query, { width = 1440, height = 900, act } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  await page.goto(`${base}?${query}`);
  await page.waitForTimeout(3000);
  if (act) await act(page);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}

const panel = (page, fn) => page.evaluate(fn);

await shot("01-overview-light", "");
await shot("02-overview-dark", "dark");
await shot("03-level", "", {
  act: async (p) => {
    await panel(p, () => window.__panel.shadowRoot.querySelector('[data-action="level"][data-level="0"]').click());
    await p.waitForTimeout(3000);
  },
});
await shot("04-room", "", {
  act: async (p) => {
    await panel(p, () => window.__panel.shadowRoot.querySelector('[data-action="level"][data-level="0"]').click());
    await p.waitForTimeout(600);
    await panel(p, () => window.__panel.shadowRoot.querySelector('[data-action="room"][data-room="living"]').click());
    await p.waitForTimeout(3000);
  },
});
await shot("05-wizard-first-run", "configured=0&floors=0");
await shot("06-wizard-edit-levels", "configured=0&floors=0", {
  act: async (p) => {
    await panel(p, () => {
      const root = window.__panel.shadowRoot;
      root.querySelector('[data-action="add-floor"]').click();
    });
    await p.waitForTimeout(1200);
  },
});
await shot("07-wizard-energy", "configured=0&floors=0", {
  act: async (p) => {
    await panel(p, () => window.__panel.shadowRoot.querySelector('[data-action="wizard-next"]').click());
    await panel(p, () => {
      const box = window.__panel.shadowRoot.querySelector('[data-setting="heat_pump"]');
      box.click();
    });
    await p.waitForTimeout(1000);
  },
});
await shot("08-wizard-devices", "configured=0&floors=0", {
  act: async (p) => {
    await panel(p, () => window.__panel.shadowRoot.querySelector('[data-action="wizard-next"]').click());
    await panel(p, () => window.__panel.shadowRoot.querySelector('[data-action="wizard-save"]').click());
    await p.waitForTimeout(3000);
  },
});
await shot("09-mobile", "narrow", { width: 390, height: 844 });
await shot("10-mobile-dark-level", "narrow&dark", {
  width: 390,
  height: 844,
  act: async (p) => {
    await panel(p, () => window.__panel.shadowRoot.querySelector('[data-action="level"][data-level="1"]').click());
    await p.waitForTimeout(3000);
  },
});

await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no page errors");
