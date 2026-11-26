// Run against an existing dev server: node e2e/themes.mjs
// Pi Web has one palette, the dark one: the app must paint it and offer no picker.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = fileURLToPath(new URL("../test-results/themes/", import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();

function contrast(a, b) {
  const luminance = (hex) => {
    const digits = hex.length === 4 ? [...hex.slice(1)].map((digit) => digit + digit).join("") : hex.slice(1);
    const channels = digits.match(/../g).map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-US", colorScheme: "light", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Keep the check independent of the user's session catalogue.
    await page.route(/\/api\/sessions(?:\?.*)?$/, (route) => route.fulfill({ json: { sessions: [] } }));
    await page.goto(base);
    await page.getByText("No sessions found", { exact: true }).waitFor({ state: "attached" });

    const expectDark = async () => {
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      assert.equal(await page.locator("html").evaluate((root) => root.classList.contains("dark")), true);
      assert.equal(await page.locator("html").evaluate((root) => getComputedStyle(root).colorScheme), "dark");
    };
    const checkPalette = async () => {
      const colors = await page.locator("html").evaluate((root) => {
        const style = getComputedStyle(root);
        return Object.fromEntries(["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg", "text", "text-muted", "text-dim", "accent", "accent-hover", "accent-contrast"].map((key) => [key, style.getPropertyValue(`--${key}`).trim()]));
      });
      for (const foreground of ["text", "text-muted", "text-dim", "accent"]) {
        for (const background of ["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg"]) {
          assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${foreground} on ${background} must meet WCAG AA`);
        }
      }
      for (const background of ["accent", "accent-hover"]) {
        assert.ok(contrast(colors["accent-contrast"], colors[background]) >= 4.5, "button contrast");
      }
    };

    await expectDark();
    await checkPalette();

    // The system scheme and a stale `pi-theme` value must not repaint the app.
    await page.evaluate(() => localStorage.setItem("pi-theme", "light"));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expectDark();
    await page.emulateMedia({ colorScheme: "light" });
    await expectDark();

    const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (width <= 640) await sidebar.waitFor();
    if (await sidebar.isVisible()) await sidebar.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    assert.equal(await page.getByRole("radiogroup").count(), 0, "Settings must not offer a theme picker");
    await expectDark();
    await page.screenshot({ path: `${artifacts}/settings-${width}.png`, animations: "disabled" });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: fixed dark palette, contrast, no picker, ignores system scheme and stored preference`);
    await context.close();
  }
} finally {
  await browser.close();
}
