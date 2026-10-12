export type TextUnit = { id: string; original: string; start: number; end: number };
export type TextUnitKind = "grapheme" | "word" | "line";
const hash = (text: string) => {
  let value = 2166136261;
  for (const char of text) {
    value ^= char.codePointAt(0)!;
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
};
export function segmentText(text: string, unit: TextUnitKind): TextUnit[] {
  const segments: { original: string; start: number; end: number }[] = [];
  if (unit === "line") {
    const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    for (const match of text.matchAll(pattern))
      if (match[0])
        segments.push({ original: match[0], start: match.index, end: match.index + match[0].length });
  } else {
    const segmenter = new Intl.Segmenter("ko", { granularity: unit });
    for (const item of segmenter.segment(text))
      segments.push({ original: item.segment, start: item.index, end: item.index + item.segment.length });
  }
  const occurrences = new Map<string, number>();
  return segments.map((segment) => {
    const normalized = segment.original.normalize("NFC"),
      key = hash(normalized),
      occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return { ...segment, id: `${unit}:${key}:${occurrence}` };
  });
}
/** Matches normalized content in sequence while retaining the user's original text bytes. */
export function reconcileTextUnits(
  previous: TextUnit[],
  text: string,
  unit: TextUnitKind,
): { units: TextUnit[]; orphanIds: string[] } {
  const units = segmentText(text, unit),
    rows = previous.length + 1,
    columns = units.length + 1;
  // Prefix/suffix matching bounds memory for long text; normal title/caption edits use exact LCS.
  const matches = new Map<number, number>();
  if (rows * columns <= 1_000_000) {
    const table = Array.from({ length: rows }, () => new Uint32Array(columns));
    for (let a = previous.length - 1; a >= 0; a--)
      for (let b = units.length - 1; b >= 0; b--)
        table[a][b] =
          previous[a].original.normalize("NFC") === units[b].original.normalize("NFC")
            ? 1 + table[a + 1][b + 1]
            : Math.max(table[a + 1][b], table[a][b + 1]);
    let a = 0,
      b = 0;
    while (a < previous.length && b < units.length) {
      if (previous[a].original.normalize("NFC") === units[b].original.normalize("NFC")) {
        matches.set(b, a);
        a++;
        b++;
      } else if (table[a + 1][b] >= table[a][b + 1]) a++;
      else b++;
    }
  } else {
    let a = 0;
    for (let b = 0; b < units.length; b++) {
      while (
        a < previous.length &&
        previous[a].original.normalize("NFC") !== units[b].original.normalize("NFC")
      )
        a++;
      if (a < previous.length) matches.set(b, a++);
    }
  }
  const used = new Set<string>();
  for (const [b, a] of matches) {
    units[b].id = previous[a].id;
    used.add(previous[a].id);
  }
  for (let b = 0; b < units.length; b++)
    if (!matches.has(b)) {
      const base = units[b].id;
      let suffix = 0;
      while (used.has(units[b].id) || previous.some((p) => p.id === units[b].id))
        units[b].id = `${base}:new${++suffix}`;
      used.add(units[b].id);
    }
  return { units, orphanIds: previous.filter((p) => !used.has(p.id)).map((p) => p.id) };
}
