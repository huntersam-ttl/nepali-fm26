import React, { useEffect, useRef, useState } from "react";
import type { SceneMotion, SceneQualitySettings } from "./scenePreferences.js";

/**
 * The reusable 3D scene host every presentation scene mounts through.
 *
 * It owns exactly the concerns no individual scene should re-solve: loading
 * three lazily (so the 3D chunk never costs anything until a scene is really
 * shown), sizing, pausing when hidden, releasing the GPU context on unmount,
 * surviving a lost context, and handing control back to a 2D fallback when
 * anything at all goes wrong. A scene module only describes its own contents.
 */

export type SceneHandle = {
  scene: unknown;
  camera: unknown;
  update: (elapsedSeconds: number) => void;
  pickables: Array<{ object: unknown; building: string }>;
  dispose: () => void;
};

export type SceneFactory = (quality: SceneQualitySettings, motion: SceneMotion) => Promise<SceneHandle>;

type Status = "loading" | "ready" | "failed";

export const SceneCanvas = ({
  factory,
  quality,
  motion,
  ariaLabel,
  onPick,
  fallback,
  className,
}: {
  /** Builds the scene contents. Async so the caller can dynamic-import three. */
  factory: SceneFactory;
  quality: SceneQualitySettings;
  motion: SceneMotion;
  /** What this scene depicts, for assistive technology. */
  ariaLabel: string;
  /** Fired when the player clicks a pickable object, with its block key. */
  onPick?: (building: string) => void;
  /** Rendered instead of the canvas whenever 3D cannot or should not run. */
  fallback: React.ReactNode;
  className?: string;
}): React.ReactElement => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  // Kept in a ref so the click handler always sees the live handle without
  // re-running the whole scene effect.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let frame = 0;
    let renderer: import("three").WebGLRenderer | undefined;
    let handle: SceneHandle | undefined;
    let raycaster: import("three").Raycaster | undefined;
    let three: typeof import("three") | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let visible = true;
    let onCanvasClick: ((event: MouseEvent) => void) | undefined;
    let onContextLost: ((event: Event) => void) | undefined;
    const observers: Array<{ disconnect: () => void }> = [];

    const start = async (): Promise<void> => {
      try {
        // Both the library and the scene contents arrive in one lazy chunk.
        three = await import("three");
        if (disposed) return;
        handle = await factory(quality, motion);
        if (disposed) {
          handle.dispose();
          return;
        }

        renderer = new three.WebGLRenderer({
          antialias: quality.antialias,
          alpha: false,
          powerPreference: "default",
        });
        renderer.setPixelRatio(Math.min(quality.pixelRatio, globalThis.devicePixelRatio ?? 1));
        renderer.shadowMap.enabled = quality.shadows;
        canvas = renderer.domElement;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", ariaLabel);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        host.appendChild(canvas);
        raycaster = new three.Raycaster();

        /**
         * Matches the drawing buffer to the element's real displayed size.
         * Called before every frame rather than only from a ResizeObserver:
         * the observer alone proved unreliable here (a panel that grows after
         * mount kept a stale buffer and rendered stretched), and comparing two
         * numbers per frame is far cheaper than a wrong-resolution render.
         */
        const resizeToDisplaySize = (): void => {
          if (!renderer || !handle) return;
          const bounds = host.getBoundingClientRect();
          const width = Math.max(1, Math.round(bounds.width));
          const height = Math.max(1, Math.round(bounds.height));
          const current = renderer.getSize(new three!.Vector2());
          if (current.x === width && current.y === height) return;
          renderer.setSize(width, height, false);
          const camera = handle.camera as import("three").PerspectiveCamera;
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        resizeToDisplaySize();

        // Two independent resize paths on purpose. The observer covers a still
        // scene (no loop to resize it) and a resize that happens while the
        // window is in the background, where requestAnimationFrame is
        // suspended entirely; the per-frame check in the loop covers anything
        // the observer misses. Both are cheap, and a stale drawing buffer
        // renders the scene stretched, so it is worth paying for both.
        if (globalThis.ResizeObserver) {
          const resizeObserver = new globalThis.ResizeObserver(() => {
            resizeToDisplaySize();
            if (motion === "OFF" && renderer && handle) {
              renderer.render(handle.scene as import("three").Scene, handle.camera as import("three").Camera);
            }
          });
          resizeObserver.observe(host);
          observers.push(resizeObserver);
        }

        // Stop drawing entirely when scrolled out of view — an idle scene must
        // not keep a GPU busy behind the rest of the screen.
        if (globalThis.IntersectionObserver) {
          const intersectionObserver = new globalThis.IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
          });
          intersectionObserver.observe(host);
          observers.push(intersectionObserver);
        }

        if (onPick || pickRef.current) {
          onCanvasClick = (event: MouseEvent): void => {
            if (!handle || !raycaster || !three || !canvas) return;
            const bounds = canvas.getBoundingClientRect();
            const pointer = new three.Vector2(
              ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
              -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
            );
            raycaster.setFromCamera(pointer, handle.camera as import("three").Camera);
            for (const pickable of handle.pickables) {
              const hits = raycaster.intersectObject(pickable.object as import("three").Object3D, true);
              if (hits.length > 0) {
                pickRef.current?.(pickable.building);
                return;
              }
            }
          };
          canvas.addEventListener("click", onCanvasClick);
        }

        // A driver can drop the context at any time; fall back rather than
        // leaving a frozen black rectangle on screen.
        onContextLost = (event: Event): void => {
          event.preventDefault();
          setStatus("failed");
        };
        canvas.addEventListener("webglcontextlost", onContextLost);

        const startedAt = performance.now();
        const loop = (): void => {
          frame = requestAnimationFrame(loop);
          if (!renderer || !handle) return;
          const hidden = globalThis.document?.visibilityState === "hidden";
          if (!visible || hidden) return;
          resizeToDisplaySize();
          if (motion !== "OFF") handle.update((performance.now() - startedAt) / 1000);
          renderer.render(handle.scene as import("three").Scene, handle.camera as import("three").Camera);
        };

        // Always draw one frame eagerly, before any visibility gating. A scene
        // that mounts while the window is in the background or scrolled out of
        // view would otherwise hold an empty canvas until the loop first runs,
        // which on a static (motion: OFF) scene is never.
        renderer.render(handle.scene as import("three").Scene, handle.camera as import("three").Camera);
        if (motion !== "OFF") frame = requestAnimationFrame(loop);
        setStatus("ready");
      } catch {
        if (!disposed) setStatus("failed");
      }
    };

    void start();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      for (const observer of observers) observer.disconnect();
      if (canvas && onCanvasClick) canvas.removeEventListener("click", onCanvasClick);
      if (canvas && onContextLost) canvas.removeEventListener("webglcontextlost", onContextLost);
      handle?.dispose();
      // Releasing the WebGL context here is what stops repeated opens of this
      // screen from stacking up GPU contexts until the driver refuses more.
      renderer?.dispose();
      renderer?.forceContextLoss?.();
      if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
    };
    // A quality/motion change rebuilds the scene deliberately.
  }, [factory, quality, motion, ariaLabel, onPick]);

  if (status === "failed") return <>{fallback}</>;

  return (
    <div className={className ? `scene-host ${className}` : "scene-host"}>
      <div ref={hostRef} className="scene-host-canvas" aria-hidden={status !== "ready"} />
      {status === "loading" && (
        <div className="scene-host-loading" role="status">
          Preparing club view…
        </div>
      )}
    </div>
  );
};

/**
 * Keeps a failed scene from taking the surrounding screen down with it. A
 * broken stadium view is a cosmetic problem; the club's finances, squad and
 * navigation around it must stay usable.
 */
export class SceneErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
