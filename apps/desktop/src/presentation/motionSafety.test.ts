import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A UI animation must never be able to hide content.
 *
 * WebKit suspends animations for a window that is not in the foreground, and a
 * suspended animation sits frozen on its first keyframe forever. This was
 * measured, not theorised: an entrance animation that began at `opacity: 0`
 * left every panel on the screen fully transparent in an unfocused window —
 * a blank game until the player clicked on it.
 *
 * So keyframes may move things. They may not fade them in, collapse them, or
 * otherwise start from a state in which the content cannot be read.
 */

const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

/** Every `@keyframes name { ... }` block in the stylesheet. */
const keyframeBlocks = (): Array<{ name: string; body: string }> => {
  const blocks: Array<{ name: string; body: string }> = [];
  const pattern = /@keyframes\s+([\w-]+)\s*\{/g;
  let match = pattern.exec(css);
  while (match !== null) {
    // Walk braces from the opening one so nested keyframe steps are included.
    let depth = 1;
    let index = pattern.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ name: match[1], body: css.slice(pattern.lastIndex, index - 1) });
    match = pattern.exec(css);
  }
  return blocks;
};

describe("no animation can hide the interface", () => {
  it("finds the keyframes it is meant to be checking", () => {
    const names = keyframeBlocks().map((block) => block.name);
    expect(names).toContain("motion-enter");
    expect(names).toContain("inbox-arrive");
  });

  it("never animates opacity — a frozen fade-in is an invisible screen", () => {
    const offenders = keyframeBlocks().filter((block) => /(^|[;{\s])opacity\s*:/.test(block.body));
    expect(offenders.map((block) => block.name)).toEqual([]);
  });

  it("never animates a property that can collapse or blank an element", () => {
    const forbidden = /(^|[;{\s])(visibility|display|max-height|height|width|clip-path)\s*:/;
    const offenders = keyframeBlocks().filter((block) => forbidden.test(block.body));
    expect(offenders.map((block) => block.name)).toEqual([]);
  });

  it("keeps every animation behind a reduced-motion escape hatch", () => {
    const animated = [...css.matchAll(/\.([\w-]+)\s*\{[^}]*\banimation\s*:/g)].map((match) => match[1]);
    expect(animated.length).toBeGreaterThan(0);
    const reducedBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const className of animated) {
      expect(reducedBlock).toContain(`.${className}`);
    }
  });
});
