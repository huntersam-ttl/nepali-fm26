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

  /**
   * Weighted pick that consumes exactly ONE draw (same RNG cost as `pick`), so
   * it can replace a uniform `pick` inside the load-bearing match-minute draw
   * order without shifting the stream. A non-positive total weight falls back
   * to a uniform pick over the same single draw.
   */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty collection");
    }
    const weights = items.map((item) => Math.max(0, weightOf(item)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const roll = this.next();
    if (total <= 0) return items[Math.floor(roll * items.length)] ?? items[items.length - 1]!;
    let target = roll * total;
    for (let index = 0; index < items.length; index += 1) {
      target -= weights[index]!;
      if (target < 0) return items[index]!;
    }
    return items[items.length - 1]!;
  }
}
