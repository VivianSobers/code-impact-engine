import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/screenshots/history");
const USERNAME = process.env.CIE_TEST_USERNAME ?? "ana";
const PASSWORD = process.env.CIE_TEST_PASSWORD ?? "adminpassword123";
const EXECUTABLE_PATH = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const VIEWPORT = { width: 1440, height: 900 };

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true });

async function capture(page, name, route) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "load", timeout: 60000 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
  console.log(`${name}.png  ${route}`);
}

try {
  // Capture public login page
  const publicContext = await browser.newContext({ viewport: VIEWPORT });
  const publicPage = await publicContext.newPage();
  await capture(publicPage, "01-login", "/login");
  await publicContext.close();

  // Capture authenticated pages as admin
  const authContext = await browser.newContext({ viewport: VIEWPORT });
  const authResponse = await authContext.request.post(`${BASE_URL}/api/session`, {
    data: { username: USERNAME, password: PASSWORD },
  });
  if (authResponse.status() !== 200) {
    throw new Error(`Authentication failed: ${authResponse.status()}`);
  }

  const page = await authContext.newPage();
  await capture(page, "02-dashboard", "/dashboard");
  await capture(page, "03-commits", "/commits");
  await capture(page, "04-commit-detail", "/commits/5");
  await capture(page, "05-semantic-search", "/search?q=parse+accept+header");
  await capture(page, "06-clones-queue", "/clones");
  await capture(page, "07-clone-detail", "/clones/30");
  await capture(page, "08-admin-users", "/admin/users");
  await authContext.close();
} finally {
  await browser.close();
}
