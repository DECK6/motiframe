import { useEffect, useRef, useState } from "react";
import type { EditCommand } from "../../../../packages/document/src/commands";
import type { JsonValue } from "../../../../packages/document/src/schema";
import type { AssetFileStatus } from "../../../runner/src/relink-asset";
import type { PanelProps } from "../types";

type AssetView = {
  kind?: string;
  logicalPath?: string;
  sha256?: string;
  missing?: boolean;
  mediaMetadata?: {
    duration?: number;
    width?: number;
    height?: number;
    fps?: { num: number; den: number };
    rotation?: number;
    vfr?: boolean;
  };
  fontMetadata?: { family?: string };
};
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
export default function AssetPanel({ document, tick, selection, submit, refresh, notify, api }: PanelProps) {
  const [busy, setBusy] = useState(false),
    [names, setNames] = useState<Record<string, string>>({}),
    [family, setFamily] = useState(""),
    [fileStatus, setFileStatus] = useState<Record<string, AssetFileStatus>>({}),
    input = useRef<HTMLInputElement>(null),
    relinkInput = useRef<HTMLInputElement>(null),
    relinkId = useRef<string | null>(null),
    statusRequest = useRef(0);
  async function refreshStatus() {
    const request = ++statusRequest.current,
      result = await api<Record<string, AssetFileStatus>>("/api/asset-status");
    if (request === statusRequest.current && result.ok) setFileStatus(result.value);
  }
  useEffect(() => {
    void refreshStatus();
    return () => {
      statusRequest.current++;
    };
  }, [document.id, document.revision]);
  const assets = Object.entries(document.assets).map(([id, value]) => {
    const asset = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as AssetView;
    return { id, asset: { ...asset, missing: fileStatus[id]?.missing ?? asset.missing } };
  });
  async function relink(file: File | undefined) {
    const assetId = relinkId.current;
    if (!file || !assetId) return;
    if (file.size > 180 * 1024 * 1024) {
      notify("The maximum relink size is 180 MiB.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ restored: boolean }>("/api/asset-relink", {
        assetId,
        base64: await readBase64(file),
      });
      if (!result.ok) {
        notify(result.error.message);
        return;
      }
      setNames((current) => ({ ...current, [assetId]: file.name }));
      await refresh();
      await refreshStatus();
      window.dispatchEvent(new CustomEvent("motiframe-assets-changed"));
      notify(
        result.value.restored
          ? `Restored ${file.name} with its original content hash.`
          : "The original asset is already available.",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (relinkInput.current) relinkInput.current.value = "";
      relinkId.current = null;
    }
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let imported = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > 180 * 1024 * 1024) {
          notify(`${file.name}: maximum import size is 180 MiB`);
          continue;
        }
        const result = await api<{ assetId: string }>("/api/asset", {
          name: file.name,
          base64: await readBase64(file),
          ...(family.trim() ? { family: family.trim() } : {}),
        });
        if (!result.ok) {
          notify(`${file.name}: ${result.error.message}`);
          continue;
        }
        setNames((current) => ({ ...current, [result.value.assetId]: file.name }));
        imported++;
      }
      await refresh();
      if (imported)
        notify(`Imported ${imported} asset${imported === 1 ? "" : "s"}. Add it to the timeline below.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function add(id: string, asset: AssetView) {
    if (asset.missing) {
      notify("Relink the missing asset before adding it.");
      return;
    }
    if (asset.kind === "font") {
      if (!selection.length) {
        notify("Select a text layer before applying a font.");
        return;
      }
      const fontFamily = asset.fontMetadata?.family;
      if (!fontFamily) {
        notify("This font has no family metadata.");
        return;
      }
      await submit(selection.map((instanceId) => ({ type: "SetProps", instanceId, props: { fontFamily } })));
      return;
    }
    const audio = asset.kind === "audio",
      definition = Object.entries(document.definitions).find(
        ([, item]) => item.moduleHash === (audio ? "builtin:audio" : "builtin:media"),
      );
    const track = document.tracks.find((item) => item.kind === (audio ? "audio" : "video") && !item.locked);
    if (!definition || !track) {
      notify(`An unlocked ${audio ? "audio" : "video"} track and media definition are required.`);
      return;
    }
    const step = 240000 / document.settings.fps.num,
      scene =
        Object.entries(document.scenes).find(
          ([, item]) => tick >= item.start && tick < item.start + item.duration,
        ) ?? Object.entries(document.scenes)[0];
    if (!scene) {
      notify("Create a scene before adding media.");
      return;
    }
    const globalStart = Math.max(Math.ceil(scene[1].start / step) * step, Math.floor(tick / step) * step),
      remaining = document.settings.duration - globalStart;
    const sourceDuration =
      asset.kind === "image"
        ? Math.min(720000, remaining)
        : Math.floor(((asset.mediaMetadata?.duration ?? 0) * 240000) / 5) * 5;
    const duration = Math.floor(Math.min(remaining, sourceDuration) / step) * step;
    if (duration < step) {
      notify("There is no complete frame available for this asset at the playhead.");
      return;
    }
    const instanceId = `media-${crypto.randomUUID()}`,
      metadata = asset.mediaMetadata,
      rotated = metadata?.rotation === 90 || metadata?.rotation === 270;
    const width = (rotated ? metadata?.height : metadata?.width) ?? document.settings.width,
      height = (rotated ? metadata?.width : metadata?.height) ?? document.settings.height;
    const scale = Math.min(
      document.settings.width / Math.max(1, width),
      document.settings.height / Math.max(1, height),
    );
    const commands: EditCommand[] = [
      {
        type: "AddInstance",
        instanceId,
        sceneId: scene[0],
        instance: {
          definitionId: definition[0],
          definitionRevision: definition[1].revision,
          parentId: null,
          slotId: null,
          trackId: track.id,
          start: globalStart - scene[1].start,
          duration,
          props: audio
            ? {}
            : { assetId: id, width: Math.round(width * scale), height: Math.round(height * scale) },
          locked: false,
        },
      },
    ];
    if (asset.kind !== "image")
      commands.push({
        type: "SetMediaClip",
        instanceId,
        clip: {
          assetId: id,
          sourceIn: 0,
          sourceOut: sourceDuration,
          rate: { num: 1, den: 1 },
          gain: 1,
        } as JsonValue,
      });
    if (await submit(commands))
      notify(
        `Added ${names[id] ?? asset.logicalPath?.split("/").at(-1) ?? "asset"} at ${(globalStart / 240000).toFixed(2)} s`,
      );
  }
  return (
    <section className="panel-stack" aria-label="Assets">
      <div className="field-row">
        <strong>Assets</strong>
        <span className="badge">{assets.length}</span>
      </div>
      <button type="button" className="primary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Importing…" : "Import media or font"}
      </button>
      <input
        ref={input}
        type="file"
        aria-label="Import assets"
        accept=".mp4,.mov,.png,.jpg,.jpeg,.webp,.wav,.mp3,.ttf,.otf"
        multiple
        hidden
        disabled={busy}
        onChange={(event) => void importFiles(event.currentTarget.files)}
      />
      <input
        ref={relinkInput}
        type="file"
        hidden
        aria-label="Relink original asset file"
        disabled={busy}
        onChange={(event) => void relink(event.currentTarget.files?.[0])}
      />
      <label className="field-row">
        Font family
        <input
          value={family}
          onChange={(event) => setFamily(event.currentTarget.value)}
          placeholder="Optional on font import"
        />
      </label>
      <p className="muted">
        Video, image, audio, or font. Add media at the playhead; apply a font to selected layers.
      </p>
      {!assets.length && <p className="muted">Import your first asset to start building a scene.</p>}
      {assets.map(({ id, asset }) => (
        <article className="card" key={id}>
          <div className="field-row">
            <strong title={asset.logicalPath}>
              {names[id] ?? asset.logicalPath?.split("/").at(-1) ?? id}
            </strong>
            <span className="badge">{asset.kind ?? "unknown"}</span>
          </div>
          {asset.missing ? (
            <p role="status">
              {fileStatus[id]?.status === "hash-mismatch"
                ? "File contents changed · original file required"
                : "Missing or unavailable asset · relink required"}
            </p>
          ) : (
            asset.mediaMetadata && (
              <p className="muted">
                {asset.mediaMetadata.width
                  ? `${asset.mediaMetadata.width} × ${asset.mediaMetadata.height} · `
                  : ""}
                {asset.mediaMetadata.duration ? `${asset.mediaMetadata.duration.toFixed(2)} s` : ""}
                {asset.mediaMetadata.fps && asset.kind === "video"
                  ? ` · ${(asset.mediaMetadata.fps.num / asset.mediaMetadata.fps.den).toFixed(2)} fps`
                  : ""}
                {asset.mediaMetadata.vfr ? " · VFR" : ""}
                {asset.mediaMetadata.rotation ? ` · ${asset.mediaMetadata.rotation}°` : ""}
              </p>
            )
          )}
          {asset.fontMetadata?.family && <p className="muted">{asset.fontMetadata.family}</p>}
          <button type="button" disabled={busy || asset.missing} onClick={() => void add(id, asset)}>
            {asset.kind === "font" ? "Apply to selection" : "Add at playhead"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              relinkId.current = id;
              relinkInput.current?.click();
            }}
          >
            Relink original file
          </button>
        </article>
      ))}
    </section>
  );
}
