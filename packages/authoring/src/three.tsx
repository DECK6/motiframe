import { type CSSProperties, useLayoutEffect, useRef } from "react";
import {
  type BufferGeometry,
  type Camera,
  Material,
  type Mesh,
  NoToneMapping,
  type Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from "three";
import type { FrameContext } from "../../document/src/schema";

export type ThreeContext = { renderer: WebGLRenderer; width: number; height: number };
export type ThreeScene = {
  scene: Scene;
  camera: Camera;
  /** Assign state from the absolute frame tick. Do not accumulate elapsed deltas. Must finish synchronously. */
  update(frame: FrameContext, context: ThreeContext): void;
  /** Release additional resources outside the scene graph; graph geometry/materials/textures are owned here. */
  dispose?(): void;
};
export type ThreeCanvasProps = {
  frame: FrameContext;
  width: number;
  height: number;
  /** Keep this factory stable; every instance owns its scene resources. Async loading must finish before creation. */
  create(context: ThreeContext): ThreeScene;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
};
type MountedScene = { value: ThreeScene; context: ThreeContext };

function disposeGraph(scene: Scene) {
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>(),
    textures = new Set<Texture>();
  function collectTexture(value: unknown) {
    if (value instanceof Texture) textures.add(value);
    else if (Array.isArray(value)) for (const item of value) collectTexture(item);
  }
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : []) {
      materials.add(material);
      for (const value of Object.values(material)) collectTexture(value);
      const uniforms = (material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
      if (uniforms) for (const uniform of Object.values(uniforms)) collectTexture(uniform.value);
    }
  });
  collectTexture(scene.background);
  collectTexture(scene.environment);
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  scene.clear();
}

/**
 * A synchronous, tick-driven WebGL surface in the ordinary React stage.
 * Child layout effects and GPU completion precede the stage's React commit receipt.
 */
export function ThreeCanvas({
  frame,
  width,
  height,
  create,
  className,
  style,
  ariaLabel = "Three.js scene",
}: ThreeCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null),
    mounted = useRef<MountedScene | undefined>(undefined);
  useLayoutEffect(() => {
    if (!canvas.current) return;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
      throw new Error("THREE_INVALID_SIZE");
    const renderer = new WebGLRenderer({
      canvas: canvas.current,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    const context = { renderer, width, height };
    let value: ThreeScene;
    try {
      value = create(context);
      if (!value?.scene?.isScene || !value.camera?.isCamera || typeof value.update !== "function")
        throw new Error("THREE_INVALID_SCENE");
    } catch (error) {
      renderer.dispose();
      renderer.forceContextLoss();
      throw error;
    }
    mounted.current = { value, context };
    return () => {
      mounted.current = undefined;
      try {
        value.dispose?.();
      } finally {
        try {
          disposeGraph(value.scene);
        } finally {
          renderer.dispose();
          renderer.forceContextLoss();
        }
      }
    };
  }, [create, width, height]);
  useLayoutEffect(() => {
    const current = mounted.current;
    if (!current) return;
    // Hidden instances can receive a negative local tick before their timeline start.
    if (!Number.isSafeInteger(frame.tick)) throw new Error("THREE_INVALID_TICK");
    const gl = current.context.renderer.getContext();
    if (gl.isContextLost()) throw new Error("THREE_CONTEXT_LOST");
    const result = current.value.update(frame, current.context) as unknown;
    if (result && typeof (result as PromiseLike<unknown>).then === "function")
      throw new Error("THREE_ASYNC_UPDATE");
    current.context.renderer.render(current.value.scene, current.value.camera);
    gl.finish();
  }, [frame, create, width, height]);
  return (
    <canvas
      ref={canvas}
      width={width}
      height={height}
      className={className}
      aria-label={ariaLabel}
      style={{ display: "block", width, height, ...style }}
    />
  );
}
