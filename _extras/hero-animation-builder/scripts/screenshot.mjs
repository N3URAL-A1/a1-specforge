#!/usr/bin/env node
// Captures a hero section at desktop + mobile viewports, two frames each
// (~1.5s apart) so animation progress is visible as a diff.
// Usage: node screenshot.mjs <url> [outdir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2];
const outdir = process.argv[3] ?? 'screenshots';
if (!url) {
  console.error('Usage: node screenshot.mjs <url> [outdir]');
  process.exit(1);
}
mkdirSync(outdir, { recursive: true });

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch();
try {
  for (const vp of viewports) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // frame 1: shortly after load (entrance animation mid-flight)
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(outdir, `${vp.name}-t0.png`) });

    // frame 2: settled state + ambient motion progressed
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outdir, `${vp.name}-t1.png`) });

    await page.close();
    console.log(`${vp.name}: ${vp.width}x${vp.height} -> ${outdir}/${vp.name}-{t0,t1}.png`);
  }
} finally {
  await browser.close();
}
