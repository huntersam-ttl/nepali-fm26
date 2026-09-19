import { describe, expect, it } from "vitest";
import type { GameDatabase } from "@nepal-football-sim/database";
import type { EntityReferenceType, GlobalSearchResult } from "@nepal-football-sim/shared-types";
import { searchFootballWorld } from "./global-search.js";

/**
 * Unit tests for the search RANKING/SHAPE logic. They drive searchFootballWorld
 * with a fake GameDatabase that returns per-source candidate rows (labelled by
 * the same `label`/`secondary` columns the real SQL surfaces); the functions
 * under test still do all the real work we care about here — normalization,
 * case-insensitive matching, ranking, deterministic ordering, bounding, type
 * filtering and result shape. The real SQL against a live world is covered by
 * the global-search E2E.
 */

type Row = Record<string, any>;

const SUPPORTED = new Set<EntityReferenceType>([
  "PLAYER",
  "STAFF",
  "CLUB",
  "COMPETITION",
  "MEDIA_OUTLET",
  "JOURNALIST",
  "SPONSOR",
  "LENDER",
]);

const DATA: Record<string, Row[]> = {
  clubs: [
    { id: "c-three", label: "Three Star Club" },
    { id: "c-church", label: "Church Boys United" },
    { id: "c-man", label: "Machhindra FC" },
  ],
  competitions: [{ id: "k-a", label: "Martyr's Memorial A-Division League" }],
  players: [
    { id: "p-ram1", label: "Ramesh Shrestha", secondary: "AM" },
    { id: "p-aayush", label: "Aayush Ghalan" },
    { id: "p-menu", label: "Charilaos McMullan", secondary: "ST" },
  ],
  staff: [{ id: "p-s", label: "Ramesh Thapa", secondary: "Head Coach" }],
  media_outlets: [{ id: "m1", label: "Football Weekly", secondary: "national" }],
  media_journalists: [{ id: "j1", label: "The Anchor", secondary: "transfers" }],
  commercial_sponsor_profiles: [{ id: "sp1", label: "Nepal Telecom", secondary: "telecom" }],
  club_lenders: [{ id: "l1", label: "Nepal Bank" }],
};

const makeDb = (): GameDatabase => {
  const prepare = (sql: string): { all: (arg?: unknown) => Row[] } => {
    const source =
      sql.includes("staff_profiles") && sql.includes("FROM persons")
        ? DATA.staff
        : sql.includes("player_attributes") && sql.includes("FROM persons")
          ? DATA.players
          : sql.includes("FROM clubs")
            ? DATA.clubs
            : sql.includes("FROM competitions")
              ? DATA.competitions
              : sql.includes("media_outlets")
                ? DATA.media_outlets
                : sql.includes("media_journalists")
                  ? DATA.media_journalists
                  : sql.includes("commercial_sponsor_profiles")
                    ? DATA.commercial_sponsor_profiles
                    : sql.includes("club_lenders")
                      ? DATA.club_lenders
                      : ([] as Row[]);
    return { all: () => source };
  };
  return { prepare } as unknown as GameDatabase;
};

const names = (rows: GlobalSearchResult[]): string[] => rows.map((row) => row.displayName);

describe("global football world search", () => {
  it("1. returns nothing for an empty query", () => {
    const db = makeDb();
    expect(searchFootballWorld(db, { query: "" })).toEqual([]);
    expect(searchFootballWorld(db, { query: "   " })).toEqual([]);
  });

  it("2. ignores accidental leading/trailing whitespace", () => {
    const rows = searchFootballWorld(makeDb(), { query: "  three  " });
    expect(names(rows)).toContain("Three Star Club");
  });

  it("3. matches case-insensitively", () => {
    const upper = searchFootballWorld(makeDb(), { query: "THREE" });
    const lower = searchFootballWorld(makeDb(), { query: "three" });
    expect(names(upper)).toEqual(names(lower));
    expect(names(upper)).toContain("Three Star Club");
  });

  it("4. exact/prefix results rank above weaker substring matches", () => {
    const rows = searchFootballWorld(makeDb(), { query: "three", limit: 20 });
    expect(rows[0]?.displayName).toBe("Three Star Club");
    expect(rows[0]?.entityType).toBe("CLUB");
  });

  it("5. supports prefix and partial-name matches", () => {
    const firstName = searchFootballWorld(makeDb(), { query: "aayush" });
    const partial = searchFootballWorld(makeDb(), { query: "ghal" });
    expect(names(firstName)).toContain("Aayush Ghalan");
    expect(names(partial)).toContain("Aayush Ghalan");
  });

  it("6. ordering is deterministic", () => {
    const first = names(searchFootballWorld(makeDb(), { query: "a", limit: 20 }));
    const second = names(searchFootballWorld(makeDb(), { query: "a", limit: 20 }));
    expect(first).toEqual(second);
  });

  it("7. bounds the result count", () => {
    const rows = searchFootballWorld(makeDb(), { query: "a", limit: 2 });
    expect(rows.length).toBe(2);
  });

  it("8. returns a multi-entity-type result set", () => {
    const rows = searchFootballWorld(makeDb(), { query: "ramesh", limit: 20 });
    const types = new Set(rows.map((row) => row.entityType));
    expect(types.has("PLAYER")).toBe(true);
    expect(types.has("STAFF")).toBe(true);
  });

  it("9. never surfaces a non-canonical entity type", () => {
    const rows = searchFootballWorld(makeDb(), { query: "a", limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(SUPPORTED.has(row.entityType)).toBe(true);
  });

  it("10. result shape is deliberately shallow (no hidden football fields)", () => {
    const player = searchFootballWorld(makeDb(), { query: "aayush", limit: 20 }).find(
      (row) => row.entityType === "PLAYER",
    );
    expect(player).toBeDefined();
    for (const key of Object.keys(player!)) {
      expect(["reference", "displayName", "entityType", "secondaryLabel"]).toContain(key);
    }
    const json = JSON.stringify(player);
    expect(json).not.toMatch(/ability|potential|wage|salary|financial|injur/i);
  });

  it("11. produces stable EntityReference IDs", () => {
    const a = searchFootballWorld(makeDb(), { query: "church" })[0];
    const b = searchFootballWorld(makeDb(), { query: "church" })[0];
    expect(a?.reference.id).toBe("c-church");
    expect(b?.reference.id).toBe("c-church");
    expect(a?.reference.entityType).toBe("CLUB");
  });
});