import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, StaffMarketRepository, WorldRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId, Person, StaffProfile } from "@nepal-football-sim/shared-types";
import { appointNationalTeamHeadCoachForPresident, createNepalSave, ensureNationalTeamStaffStructure, FederationPersonnelError, initializeFederationGovernanceForSave } from "@nepal-football-sim/simulation";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("Federation President personnel authority", () => {
  it("appoints an eligible national-team head coach through canonical employment state and reloads", () => {
    const directory = mkdtempSync(join(tmpdir(), "federation-personnel-command-")); dirs.push(directory);
    const databasePath = join(directory, "world.sqlite");
    createNepalSave({ databasePath, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: "Federation personnel", gameVersion: "test", randomSeed: "federation-personnel" });
    const db = openGameDatabase(databasePath);
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "federation-personnel" });
    const federationId = (db.prepare("SELECT f.id FROM federations f JOIN countries c ON c.id=f.country_id WHERE c.iso_code IN ('NPL','NP') ORDER BY CASE WHEN c.iso_code='NPL' THEN 0 ELSE 1 END, f.id LIMIT 1").get() as { id: EntityId }).id;
    const teamId = (db.prepare("SELECT id FROM teams WHERE federation_id=? AND club_id IS NULL AND level='senior' AND gender='men' LIMIT 1").get(federationId) as { id: EntityId }).id;
    const presidentId = "federation-personnel-president" as EntityId;
    const world = new WorldRepository(db);
    const countryId = (db.prepare("SELECT country_id FROM federations WHERE id=?").get(federationId) as { country_id: EntityId }).country_id;
    world.insertPerson({ id: presidentId, fullName: "Federation Personnel President", displayName: "Personnel President", dateOfBirth: "1975-01-01", nationalityCountryId: countryId, genderPresentation: "unknown", languages: ["Nepali"] });
    new FederationGovernanceRepository(db).upsertLeadershipTenure({ id: "federation-personnel-tenure" as EntityId, personId: presidentId, federationId, role: "FEDERATION_PRESIDENT", termStart: "2026-01-01", termEnd: "2030-01-01", status: "ACTIVE", provenanceStatus: "SIMULATION_ONLY" });
    db.prepare("UPDATE staff_appointments SET employment_status='FORMER', end_date=? WHERE team_id=? AND role='NATIONAL_TEAM_HEAD_COACH' AND employment_status='ACTIVE'").run("2027-01-01", teamId);
    const candidateId = "federation-personnel-candidate" as EntityId;
    const person: Person = { id: candidateId, fullName: "Nepal National Coach Candidate", displayName: "National Coach Candidate", dateOfBirth: "1980-01-01", nationalityCountryId: countryId, genderPresentation: "unknown", languages: ["Nepali"] };
    world.insertPerson(person); world.insertPersonRole({ id: "federation-personnel-candidate-role" as EntityId, personId: candidateId, role: "STAFF", activeFrom: "2027-01-01" });
    const profile: StaffProfile = { id: "federation-personnel-candidate-profile" as EntityId, personId: candidateId, preferredRole: "NATIONAL_TEAM_HEAD_COACH", salaryExpectation: "NATIONAL_TEAM_SCALE", reputation: "SIMULATION_ONLY", countryKnowledge: [person.nationalityCountryId], clubKnowledge: [], availability: "AVAILABLE", workEligibilityStatus: "ELIGIBLE" };
    world.insertStaffProfile(profile);
    const appointment = appointNationalTeamHeadCoachForPresident(db, { federationId, nationalTeamId: teamId, presidentPersonId: presidentId, candidatePersonId: candidateId, date: "2027-01-02" });
    expect(appointment.contractId).toBeDefined();
    expect(new StaffMarketRepository(db).employmentContractById(appointment.contractId!)).toMatchObject({ teamId, status: "ACTIVE" });
    expect(ensureNationalTeamStaffStructure(db, { federationId, nationalTeamId: teamId, date: "2027-01-03" }).find((entry) => entry.role === "NATIONAL_TEAM_HEAD_COACH")?.personId).toBe(candidateId);
    expect(() => appointNationalTeamHeadCoachForPresident(db, { federationId, nationalTeamId: teamId, presidentPersonId: "wrong-president" as EntityId, candidatePersonId: candidateId, date: "2027-01-04" })).toThrow(FederationPersonnelError);
    expect(() => appointNationalTeamHeadCoachForPresident(db, { federationId, nationalTeamId: teamId, presidentPersonId: presidentId, candidatePersonId: candidateId, date: "2027-01-04" })).toThrow("already has a head coach");
    db.close();
    const reopened = openGameDatabase(databasePath);
    try { expect(new StaffMarketRepository(reopened).activeAppointment(candidateId)?.teamId).toBe(teamId); } finally { reopened.close(); }
  });
});
