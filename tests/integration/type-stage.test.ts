import { expect, it } from "vitest";
import { openStage } from "../../apps/runner/src/stage-session";
import { segmentText } from "../../packages/core/src/type/segment";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

it("retains visual line breaks when animating Korean grapheme and line units", async () => {
  const doc = createStarterProject();
  doc.settings.width = 320;
  doc.settings.height = 180;
  doc.instances.title.props = {
    text: "가\n나",
    width: 240,
    height: 120,
    fontSize: 32,
    textUnits: segmentText("가\n나", "grapheme"),
    textSelector: { range: { start: 0, end: 100 }, offset: 0, stagger: 0, shape: "linear" },
  };
  doc.channels = {};
  const stage = await openStage(320, 180);
  try {
    for (const kind of ["grapheme", "line"] as const) {
      doc.instances.title.props.textUnits = segmentText("가\n나", kind);
      expectOk(await stage.page.evaluate((doc) => window.motiframe.load(doc), doc));
      expectOk(
        await stage.page.evaluate(() =>
          window.motiframe.renderFrame({
            tick: 240000,
            frame: 30,
            fps: { num: 30, den: 1 },
            seed: 42,
            documentRevision: 0,
            frameToken: "type",
          }),
        ),
      );
      const positions = await stage.page.evaluate(() => {
        const root = document.querySelector('[data-instance="title"]')!.shadowRoot!;
        return [...root.querySelectorAll("[data-motion-text-unit]")]
          .filter((e) => e.textContent?.includes("가") || e.textContent?.includes("나"))
          .map((e) => ({ text: e.textContent, y: e.getBoundingClientRect().y }));
      });
      expect(positions).toHaveLength(2);
      expect(positions[1].y).toBeGreaterThan(positions[0].y + 20);
    }
  } finally {
    await stage.close();
  }
});
