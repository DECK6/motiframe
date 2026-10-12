import puppeteer from "puppeteer-core";

export function launchReviewBrowser(executablePath: string) {
  return puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 30000,
    // Exercise UI input and screenshots with the same macOS compositor mode
    // as the runner. A stalled separate GPU child also stops locator animation.
    args: ["--force-color-profile=srgb", ...(process.platform === "darwin" ? ["--in-process-gpu"] : [])],
  });
}
