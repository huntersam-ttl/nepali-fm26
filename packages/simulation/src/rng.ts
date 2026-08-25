import { createHash } from "node:crypto";

export class SeededRandom {
  private state: number;

  constructor(seed: string) {
    const digest = createHash("sha256").update(seed).digest();
    this.state = digest.readUInt32BE(0) || 1;
  }

  /**
   * The generator is a single-word LCG, so its entire progression is one
   * uint32. Saving and restoring that word lets a match resume mid-simulation
   * and produce exactly the future it would have produced uninterrupted.
   */
  snapshot(): number {
    return this.state;
  }

  static restore(state: number): SeededRandom {
    const rng = new SeededRandom("");
    rng.state = state >>> 0 || 1;
    return rng;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  integer(minInclusive: number, maxInclusive: number): number {
    return Math.floor(this.next() * (maxInclusive - minInclusive + 1)) + minInclusive;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty collection");
    }
    return items[this.integer(0, items.length - 1)]!;
  }
}
