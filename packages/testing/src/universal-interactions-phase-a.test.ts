import { describe, expect, it } from "vitest";
import { migrateDatabase, openGameDatabase, TransferMarketRepository, UniversalInteractionRepository } from "@nepal-football-sim/database";
import { availableUniversalInteractionActions, getInteractionHistory, openInteraction, openUniversalInteraction, submitInteractionAction, submitUniversalInteractionAction } from "@nepal-football-sim/simulation";

describe("universal interaction phase A", () => {
  it("persists bounded deterministic negotiation state and prevents retry rerolls", () => {
    const db = openGameDatabase(":memory:"); migrateDatabase(db); db.prepare("INSERT INTO countries (id,name,iso_code) VALUES (?,?,?)").run("country-1", "Nepal", "NPL"); db.prepare("INSERT INTO persons (id,full_name,nationality_country_id,languages_json) VALUES (?,?,?,?)").run("person-1", "Simulation Person", "country-1", "[]"); db.prepare("INSERT INTO persons (id,full_name,nationality_country_id,languages_json) VALUES (?,?,?,?)").run("person-2", "Simulation Counterpart", "country-1", "[]");
    const session = openUniversalInteraction(db, { interactionType: "CONTRACT_NEGOTIATION", initiator: { type: "MANAGER", entityId: "person-1" as any }, counterpart: { type: "PLAYER", entityId: "person-2" as any }, worldDate: "2027-01-01", subject: "structured terms", demands: { wage: 100 }, trust: 60, leverage: 65 });
    expect(availableUniversalInteractionActions(db, session.id)).toContain("OFFER"); const first = submitUniversalInteractionAction(db, { interactionId: session.id, action: "OFFER", tone: "PROFESSIONAL", date: "2027-01-02", seed: "same", offer: { wage: 50 } }); expect(first.stage).toBe("COUNTERED"); expect(first.patience).toBeLessThan(100); expect(new UniversalInteractionRepository(db).session(session.id)).toEqual(first); const accepted = submitUniversalInteractionAction(db, { interactionId: session.id, action: "ACCEPT", tone: "CONCILIATORY", date: "2027-01-03", seed: "same" }); expect(accepted.stage).toBe("ACCEPTED"); expect(() => submitUniversalInteractionAction(db, { interactionId: session.id, action: "ACCEPT", tone: "CONCILIATORY", date: "2027-01-04", seed: "different" })).toThrow();
    const linked = openInteraction(db, { interactionType: "CONTRACT_NEGOTIATION", initiator: { type: "MANAGER", entityId: "person-1" as any }, counterpart: { type: "PLAYER", entityId: "person-2" as any }, organisationId: "club-1" as any, subject: "renewal", worldDate: "2027-01-04", linkedReference: { type: "CONTRACT_NEGOTIATION", canonicalId: "person-2" as any } });
    expect(new UniversalInteractionRepository(db).session(linked.id)?.linkedReference?.canonicalId).toBe("person-2"); expect(getInteractionHistory(db).some((item) => item.id === linked.id)); db.close();
  });

  it("links an accepted canonical contract and makes the retry idempotent", () => {
    const db = openGameDatabase(":memory:"); migrateDatabase(db);
    db.prepare("INSERT INTO countries (id,name,iso_code) VALUES (?,?,?)").run("country-2", "Nepal", "NPL");
    db.prepare("INSERT INTO persons (id,full_name,nationality_country_id,languages_json) VALUES (?,?,?,?)").run("manager-2", "Manager", "country-2", "[]");
    db.prepare("INSERT INTO persons (id,full_name,nationality_country_id,languages_json) VALUES (?,?,?,?)").run("player-2", "Player", "country-2", "[]");
    db.prepare("INSERT INTO clubs (id,name,country_id,ownership_type) VALUES (?,?,?,?)").run("club-2", "Club", "country-2", "COMMUNITY");
    new TransferMarketRepository(db).upsertPlayerContract({
      id: "contract-2" as any, playerId: "player-2" as any, clubId: "club-2" as any,
      startDate: "2027-01-01", endDate: "2028-01-01", contractType: "PROFESSIONAL",
      salary: 100, appearanceFee: 0, goalBonus: 0, cleanSheetBonus: 0, signingBonus: 0,
      loyaltyBonus: 0, currency: "NPR", squadRole: "ROTATION", status: "ACTIVE",
      provenance: { sourceName: "test", confidence: 1, status: "SIMULATION_ONLY" },
    });
    const session = openInteraction(db, { interactionType: "CONTRACT", initiator: { type: "MANAGER", entityId: "manager-2" as any }, counterpart: { type: "PLAYER", entityId: "player-2" as any }, organisationId: "club-2" as any, subject: "existing contract", worldDate: "2027-02-01", linkedReference: { type: "CONTRACT", canonicalId: "contract-2" as any }, leverage: 100, trust: 100, relationshipState: 100 });
    submitInteractionAction(db, { interactionId: session.id, action: "STATE_POSITION", tone: "PROFESSIONAL", date: "2027-02-01", seed: "contract" });
    const applied = submitInteractionAction(db, { interactionId: session.id, action: "ACCEPT", tone: "CONCILIATORY", date: "2027-02-02", seed: "contract" });
    expect(applied.execution?.status).toBe("ALREADY_APPLIED");
    expect(applied.execution?.resultId).toBe("contract-2");
    expect(submitInteractionAction(db, { interactionId: session.id, action: "ACCEPT", tone: "CONCILIATORY", date: "2027-02-03", seed: "different" })).toEqual(applied);
    db.close();
  });
});
