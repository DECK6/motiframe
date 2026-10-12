import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import { projectRoot, runtime } from "./environment";

let bundlePromise: Promise<string> | undefined;
export async function openStage(
  width: number,
  height: number,
  options: { definitions?: string[]; signal?: AbortSignal } = {},
) {
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
  const token = randomUUID();
  const base = `/${token}`;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
    if (request.url === `${base}/stage.js`) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle);
    } else if (request.url === `${base}/definitions.js`) {
      response.setHeader("Content-Type", "text/javascript");
      response.end((options.definitions ?? []).join("\n"));
    } else if (request.url === `${base}/`) {
      response.setHeader("Content-Type", "text/html");
      response.end(
        `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}*{box-sizing:border-box}</style><div id="stage"></div><script src="${base}/stage.js"></script><script src="${base}/definitions.js"></script>`,
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
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  let closePromise: Promise<void> | undefined;
  const close = () =>
    (closePromise ??= (async () => {
      const child = browser?.process();
      child?.kill("SIGKILL");
      await browser?.close().catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    })());
  const cancel = () => {
    void close();
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    options.signal?.throwIfAborted();
    browser = await puppeteer.launch({
      executablePath: config.chrome,
      headless: true,
      args: ["--force-color-profile=srgb"],
    });
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${address.port}`;
    const allowed = new Set([
      `${origin}${base}/`,
      `${origin}${base}/stage.js`,
      `${origin}${base}/definitions.js`,
    ]);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (allowed.has(request.url()) || request.url().startsWith("data:")) void request.continue();
      else void request.abort("blockedbyclient");
    });
    browser.on("targetcreated", async (target) => {
      if (target.type() === "page") {
        const popup = await target.page();
        if (popup && popup !== page) await popup.close();
      }
    });
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`${origin}${base}/`, { timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.motiframe), { timeout: 30000 });
    async function bounded<T>(work: Promise<T>, ms = 2000): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              void close();
              reject(new Error("FRAME_TIMEOUT"));
            }, ms);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    return {
      page,
      browser,
      bounded,
      close: async () => {
        options.signal?.removeEventListener("abort", cancel);
        await close();
      },
    };
  } catch (error) {
    options.signal?.removeEventListener("abort", cancel);
    await close();
    throw error;
  }
}
