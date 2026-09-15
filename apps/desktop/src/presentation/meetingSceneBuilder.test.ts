import { describe, expect, it } from "vitest";
import { buildMeetingSceneProfile } from "./meetingScenePresentation.js";
import { buildMeetingScene } from "./meetingSceneBuilder.js";
import { qualitySettings } from "./scenePreferences.js";

const sceneFor = (
  motion: "FULL" | "REDUCED" | "OFF",
  overrides: Partial<Parameters<typeof buildMeetingSceneProfile>[0]> = {},
) =>
  buildMeetingScene(
    buildMeetingSceneProfile({
      context: "BOARDROOM",
      environmentTier: "MODEST",
      importance: "ROUTINE",
      organisationId: "club-1",
      organisationName: "Test FC",
      ...overrides,
    }),
    qualitySettings("MEDIUM"),
    motion,
  );

describe("meeting scene animation contract", () => {
  it("moves the camera over time on Full", () => {
    const handle = sceneFor("FULL");
    handle.update(0);
    const start = handle.camera.position.clone();
    handle.update(6);
    expect(handle.camera.position.equals(start)).toBe(false);
    handle.dispose();
  });

  it("never sweeps the camera on Reduced", () => {
    const handle = sceneFor("REDUCED");
    handle.update(0);
    const start = handle.camera.position.clone();
    handle.update(6);
    handle.update(18);
    expect(handle.camera.position.equals(start)).toBe(true);
    handle.dispose();
  });

  it("does nothing at all on Off", () => {
    const handle = sceneFor("OFF");
    const start = handle.camera.position.clone();
    handle.update(6);
    expect(handle.camera.position.equals(start)).toBe(true);
    handle.dispose();
  });

  it("is deterministic: the same profile builds an identical camera and object count twice", () => {
    const a = sceneFor("FULL");
    const b = sceneFor("FULL");
    expect(b.camera.position.equals(a.camera.position)).toBe(true);
    expect(b.scene.children.length).toBe(a.scene.children.length);
    a.dispose();
    b.dispose();
  });
});

describe("meeting camera presets", () => {
  it("frames a different, real position for Room and Table", () => {
    const handle = sceneFor("REDUCED");
    handle.focus("ROOM");
    const room = handle.camera.position.clone();
    handle.focus("TABLE");
    const table = handle.camera.position.clone();
    expect(room.equals(table)).toBe(false);
    handle.dispose();
  });

  it("jumps instantly on Reduced motion", () => {
    const handle = sceneFor("REDUCED");
    const before = handle.camera.position.clone();
    handle.focus("TABLE");
    const after = handle.camera.position.clone();
    expect(after.equals(before)).toBe(false);
    handle.update(1);
    expect(handle.camera.position.equals(after)).toBe(true);
    handle.dispose();
  });
});

describe("meeting scene geometry follows real state", () => {
  it("gives an Elite room visibly more geometry than a Basic one — real scale, not a fixed room", () => {
    const basic = sceneFor("OFF", { environmentTier: "BASIC" });
    const elite = sceneFor("OFF", { environmentTier: "ELITE" });
    expect(elite.scene.children.length).toBeGreaterThan(basic.scene.children.length);
    basic.dispose();
    elite.dispose();
  });

  it("gives Press a podium-and-rows layout distinct from Boardroom's shared table — not the same scene with different text", () => {
    const boardroom = sceneFor("OFF", { context: "BOARDROOM" });
    const press = sceneFor("OFF", { context: "PRESS" });
    // Different real layouts produce a different object count for the same
    // tier/importance — not merely a relabeled identical room.
    expect(boardroom.scene.children.length).not.toBe(press.scene.children.length);
    boardroom.dispose();
    press.dispose();
  });

  it("gives Signing a single desk-and-document layout distinct from Negotiation's two-sided table", () => {
    const negotiation = sceneFor("OFF", { context: "NEGOTIATION" });
    const signing = sceneFor("OFF", { context: "SIGNING" });
    // Signing has one chair (not a full side of them) and a document plane
    // on top of the desk — a genuinely different real layout, not the same
    // table re-skinned.
    expect(signing.scene.children.length).not.toBe(negotiation.scene.children.length);
    negotiation.dispose();
    signing.dispose();
  });

  it("releases its geometry on dispose rather than leaking it", () => {
    const handle = sceneFor("OFF");
    let disposed = 0;
    handle.scene.traverse((child) => {
      const mesh = child as { geometry?: { dispose: () => void } };
      if (mesh.geometry) {
        const original = mesh.geometry.dispose.bind(mesh.geometry);
        mesh.geometry.dispose = () => {
          disposed += 1;
          original();
        };
      }
    });
    handle.dispose();
    expect(disposed).toBeGreaterThan(0);
    expect(handle.scene.children.length).toBe(0);
  });
});
