import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import { projectRoot, runtime } from "./environment";

let bundlePromise: Promise<string> | undefined;
export async function openStage(width: number, height: number) {
  bundlePromise ??= build({
    entryPoints: [path.join(projectRoot, "packages/stage/src/main.tsx")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  }).then((r) => r.outputFiles[0].text);
  const bundle = await bundlePromise;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/stage.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle);
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}*{box-sizing:border-box}</style><div id="stage"></div><script src="/stage.js"></script>',
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const config = await runtime();
  try {
    const browser = await puppeteer.launch({
      executablePath: config.chrome,
      headless: true,
      args: ["--force-color-profile=srgb"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() => Boolean(window.motiframe));
    return {
      page,
      browser,
      close: async () => {
        await browser.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  } catch (error) {
    server.close();
    throw error;
  }
}
