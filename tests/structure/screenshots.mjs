import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/screenshots/structure");
const ADD_SOURCE = process.env.ADD_SOURCE ?? "https://github.com/sindresorhus/slugify";
const CHANNEL = process.env.BROWSER_CHANNEL ?? "msedge";
const VIEWPORT = { width: 1440, height: 900 };
const FULL_PAGE_LIMIT = 4200;

async function api(route) {
  const response = await fetch(`${BASE_URL}${route}`);
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
  return response.json();
}

async function repoByName(name) {
  const { repositories } = await api("/api/repositories");
  const repo = repositories.find((r) => r.name === name);
  if (!repo) throw new Error(`repository ${name} is not ingested`);
  return repo;
}

async function symbolId(repoId, name, file) {
  const { results } = await api(`/api/symbols/search?q=${encodeURIComponent(name)}&repo=${repoId}&limit=50`);
  const hit = results.find((r) => r.name === name && (!file || r.path === file));
  if (!hit) throw new Error(`symbol ${name} not found in repository ${repoId}`);
  return hit.symbolId;
}

async function capture(page, name, route, { full = true } = {}) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const file = path.join(OUT_DIR, `${name}.png`);
  if (full && height <= FULL_PAGE_LIMIT) {
    await page.screenshot({ path: file, fullPage: true });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  console.log(`${name}.png  ${route}`);
}

async function captureAddRepository(page) {
  await page.goto(`${BASE_URL}/repositories`, { waitUntil: "networkidle" });
  await page.fill('input[name="source"]', ADD_SOURCE);
  await page.click('button[type="submit"]');
  await page.getByText("Cloning and parsing").waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(OUT_DIR, "02-add-repository-pending.png") });
  console.log("02-add-repository-pending.png");
  await page.getByText(/^Added /).waitFor({ timeout: 600000 });
  await page.screenshot({ path: path.join(OUT_DIR, "03-add-repository-success.png") });
  console.log("03-add-repository-success.png");
}

const seed = await repoByName("seed-repo");
const express = await repoByName("express");
const ids = {
  roundCurrency: await symbolId(seed.repoId, "roundCurrency"),
  priceOrder: await symbolId(seed.repoId, "priceOrder"),
  create: await symbolId(seed.repoId, "create", "src/orders/service.ts"),
  tryRender: await symbolId(express.repoId, "tryRender", "lib/application.js"),
};

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ channel: CHANNEL });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

try {
  await capture(page, "01-repositories", "/repositories");
  await captureAddRepository(page);
  await capture(page, "04-repository", `/repositories/${seed.repoId}`);
  await capture(page, "05-file-detail", `/repositories/${seed.repoId}/files/src/orders/pricing.ts`);
  await capture(page, "06-symbol-detail", `/symbols/${ids.create}`);
  await capture(page, "07-call-graph", `/symbols/${ids.priceOrder}/graph?depth=2`);
  await capture(page, "08-impact", `/impact?q=roundCurrency&repo=${seed.repoId}&symbol=${ids.roundCurrency}&depth=5`);
  await capture(page, "09-search", "/impact?q=parse");
  await capture(page, "10-express-repository", `/repositories/${express.repoId}`, { full: false });
  await capture(page, "11-express-impact", `/impact?q=tryRender&repo=${express.repoId}&symbol=${ids.tryRender}&depth=4&min=0.75`);
  await capture(page, "12-express-call-graph", `/symbols/${ids.tryRender}/graph?depth=2`);
} finally {
  await browser.close();
}
