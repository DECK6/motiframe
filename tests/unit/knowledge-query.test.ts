import { describe, expect, it } from "vitest";
import { loadBundledKnowledge } from "../../packages/knowledge/src/index";
import { queryKnowledge } from "../../packages/knowledge/src/query";

const snapshot = loadBundledKnowledge();
describe("scoped motion evidence query", () => {
  it("ranks slow tension without equating tension with speed", () => {
    const packet = queryKnowledge(snapshot, { text: "느린 긴장", limit: 30 });
    expect(packet.snapshotHash).toBe(snapshot.hash);
    expect(packet.candidates.length).toBeLessThanOrEqual(3);
    expect(packet.candidates[0].conceptId).toBe("MR-TENSION");
    expect(packet.candidates[0].limits).toEqual(
      expect.arrayContaining([
        "audio_unverified",
        "continuous_playback_unverified",
        "interpretation_not_observation",
      ]),
    );
    expect(packet.candidates[0].applyWhen).toContain(
      "무엇이 아직 해결되지 않았는지 관객이 파악하며 해소 전후 대비가 있을 때.",
    );
    expect(packet.candidates[0].counterexamples).toContain(
      "고속 루프가 예측 가능하고 해결할 기대가 없다면 빠르지만 긴장감은 낮을 수 있다.",
    );
    expect(packet.candidates[0].conditions).toContainEqual({
      sceneId: "tma-2016-008-fx-the-americans-reflections--reflection-escalation",
      applyWhen: ["A dramatic reveal whose brief calls for withheld context or threat."],
      counterexamples: ["Do not import its long setup into short punchy keyword typography."],
    });
    expect(packet.candidates[0].scopes).toContain(
      "differences between sampled frames; intervening motion not fully observed",
    );
    expect(packet.candidates[0].images.every((image) => image.observation === "unverified")).toBe(true);
  });

  it("routes fast but monotonous to rhythm and Hangul typography to its language-specific technique", () => {
    expect(queryKnowledge(snapshot, { text: "빠른데 단조" }).candidates[0].conceptId).toBe("Rhythm");
    const hangul = queryKnowledge(snapshot, { text: "한글 타입" });
    expect(hangul.candidates[0].conceptId).toBe("T036");
    expect(hangul.candidates.map((c) => c.conceptId)).toContain("MR-READING");
  });

  it("does not manufacture representative scenes for T036 or MR-SPEED", () => {
    const packet = queryKnowledge(snapshot, { conceptIds: ["T036", "MR-SPEED"] });
    expect(packet.candidates.map((c) => c.conceptId)).toEqual(["T036", "MR-SPEED"]);
    for (const candidate of packet.candidates) {
      expect(candidate.sceneIds).toEqual([]);
      expect(candidate.images).toEqual([]);
      expect(candidate.evidenceClasses).not.toContain("observation");
      expect(candidate.limits).toContain("no_representative_image");
    }
    expect(packet.candidates[0].limits).toContain("hangul_reading_unverified");
  });

  it("treats exact IDs as authoritative, keeps empty queries empty, and honors a zero limit", () => {
    expect(queryKnowledge(snapshot, { text: "MR-SPEED" }).candidates[0].conceptId).toBe("MR-SPEED");
    expect(queryKnowledge(snapshot, { conceptIds: ["missing"], text: "unknown" }).candidates).toEqual([]);
    expect(queryKnowledge(snapshot, {}).candidates).toEqual([]);
    expect(queryKnowledge(snapshot, { text: "한글", limit: 0 }).candidates).toEqual([]);
    expect(queryKnowledge(snapshot, { text: "한글", limit: 1 }).candidates).toHaveLength(1);
    expect(
      queryKnowledge(snapshot, { text: "한글", limit: Number.NaN }).candidates.length,
    ).toBeLessThanOrEqual(3);
  });

  it("propagates unavailable images and preserves source limits without claiming playback", () => {
    const copy = structuredClone(snapshot);
    for (const asset of copy.assets) {
      asset.status = "unavailable";
      asset.reason = "missing";
    }
    const candidate = queryKnowledge(copy, { conceptIds: ["MR-TENSION"] }).candidates[0];
    expect(candidate.limits).toContain("image_unavailable");
    expect(candidate.sourceLimits).toContain(
      "연속 재생·오디오 미검증. 표본 시점/간격은 물체속도 또는 좋은 리듬의 측정이 아니다.",
    );
    expect(candidate.observations.every((item) => item.source === "inherited")).toBe(true);
  });
});
