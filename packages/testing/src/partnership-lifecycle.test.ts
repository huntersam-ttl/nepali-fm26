import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ClubNetworkRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, isInternationalClubPartnershipActive, type EntityId, type InternationalClubPartnership } from "@nepal-football-sim/shared-types";
import { processPartnershipLifecycle } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const partnership = (suffix: string, status: InternationalClubPartnership["status"], endDate?: string): InternationalClubPartnership => ({
  id: createStableEntityId("partnership-lifecycle", suffix),
  fromClubId: createStableEntityId("club", `home:${suffix}`) as EntityId,
  toClubId: createStableEntityId("club", `partner:${suffix}`) as EntityId,
  partnershipType: "SCOUTING",
  relationshipStrength: 70,
  startDate: "2026-08-01",
  endDate,
  status,
  provenanceStatus: "SIMULATION_ONLY",
});

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("partnership lifecycle", () => {
  it("uses inclusive end dates and expires due records exactly once", () => {
    const db = openGameDatabase(":memory:"); const repo = new ClubNetworkRepository(db); const value = partnership("bounded", "ACTIVE", "2026-08-10"); repo.upsertPartnership(value);
    expect(isInternationalClubPartnershipActive(value, "2026-07-31")).toBe(false);
    expect(isInternationalClubPartnershipActive(value, "2026-08-01")).toBe(true);
    expect(repo.activeScoutingPartnerships(value.fromClubId, "2026-08-10")).toHaveLength(1);
    expect(repo.activeScoutingPartnerships(value.fromClubId, "2026-08-11")).toEqual([]);
    expect(processPartnershipLifecycle(db, "2026-08-11")).toHaveLength(1);
    expect(processPartnershipLifecycle(db, "2026-08-11")).toEqual([]);
    expect(repo.partnerships(value.fromClubId)[0]?.status).toBe("EXPIRED");
    db.close();
  });

  it("keeps suspension distinct, preserves open-ended records, and reloads terminal state", () => {
    const dir = mkdtempSync(join(tmpdir(), "partnership-lifecycle-")); dirs.push(dir); const path = join(dir, "career.sqlite"); const db = openGameDatabase(path); const repo = new ClubNetworkRepository(db);
    const suspended = partnership("suspended", "SUSPENDED", "2026-08-10"); const open = partnership("open", "ACTIVE"); const future = { ...partnership("future", "ACTIVE", "2026-09-10"), startDate: "2026-09-01" };
    repo.upsertPartnership(suspended); repo.upsertPartnership(open); repo.upsertPartnership(future);
    expect(repo.activeScoutingPartnerships(suspended.fromClubId, "2026-08-11")).toEqual([]);
    expect(processPartnershipLifecycle(db, "2026-08-11")).toHaveLength(1);
    expect(repo.partnerships(suspended.fromClubId).find((item) => item.id === suspended.id)?.status).toBe("EXPIRED");
    expect(repo.activeScoutingPartnerships(open.fromClubId, "2030-01-01")).toHaveLength(1);
    expect(repo.activeScoutingPartnerships(future.fromClubId, "2026-08-15")).toEqual([]);
    db.close(); const reloaded = openGameDatabase(path); expect(new ClubNetworkRepository(reloaded).partnerships(suspended.fromClubId).find((item) => item.id === suspended.id)?.status).toBe("EXPIRED"); reloaded.close();
  });
});
