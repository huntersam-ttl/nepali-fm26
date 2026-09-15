import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  FederationGovernanceRepository,
  MediaPhaseBRepository,
  TransferMarketRepository,
  SquadDynamicsRepository,
  openGameDatabase,
  migrateDatabase,
} from "@nepal-football-sim/database";
import { DesktopApplicationService, assignResponsibility, createFederationProject } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Consolidated duplicate-topic-suppression and follow-up-transition audit,
 * driven entirely through the same canonical production/command paths the
 * app itself uses (DesktopApplicationService.evaluate*Press/request*Press/
 * answer*Press) — never a direct-helper shortcut that could pass while
 * production routing still duplicates. Complements (never duplicates)
 * press-backlog-and-refresh-loop.test.ts (which already proves the
 * repeated-call-while-OPEN / never-resurrect invariant for Owner/President/
 * SD) and press-interviews.test.ts's TRANSFER/PLAYER_ISSUE cooldown tests.
 */

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const nextDay = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const character = {
  fullName: "Dedupe Tester",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

describe("press dedupe and follow-up — OWNER_BUSINESS", () => {
  it("suppresses an unchanged fact across repeated evaluation, gives a distinct same-day fact real coverage, and survives a save/reload without duplicating or resurrecting", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "dedupe-owner-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data.find((option) => option.division === "C") ?? clubs.data[0]!;
    const created = service.createCareer({ careerMode: "OWNER", saveName: "Dedupe Owner", joinTeamId: club.teamId, character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    const saveId = created.data.save.id;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    const realClubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(club.teamId) as { club_id: EntityId }).club_id;
    new ClubEconomyRepository(db).upsertInfrastructureProject({
      id: "dedupe-owner-project" as EntityId,
      clubId: realClubId,
      projectType: "STAND",
      planningStart: "2026-01-01",
      expectedCompletion: "2027-01-01",
      capitalCost: 5_000_000,
      ongoingCost: 100_000,
      currency: "NPR",
      status: "APPROVED",
      financingJson: {},
      provenanceStatus: "SIMULATION_ONLY",
    });
    db.close();
    expect(service.loadCareer(saveId).ok).toBe(true);

    // Same tick / repeated dashboard-mount / repeated producer call — same
    // unchanged fact(s) must never duplicate, however many real candidate
    // topics (the seeded project, plus whatever founding sponsorship this
    // club already carries from world generation) bundle into this one
    // conference.
    const firstIds = new Set<EntityId>();
    for (let i = 0; i < 5; i += 1) {
      const evaluated = service.evaluateOwnerBusinessPress();
      expect(evaluated.ok).toBe(true);
      if (evaluated.ok && evaluated.data) firstIds.add(evaluated.data.interviewId);
    }
    expect(firstIds.size).toBe(1);
    const firstId = [...firstIds][0]!;
    for (let guard = 0; guard < 4; guard += 1) {
      const view = service.getOwnerStructuredPressConference(firstId);
      expect(view.ok).toBe(true);
      if (!view.ok || view.data.status === "COMPLETED") break;
      const stance = view.data.currentQuestion?.options[0]?.stance;
      expect(stance).toBeDefined();
      expect(service.answerOwnerStructuredPressQuestion({ interviewId: firstId, stance: stance! }).ok).toBe(true);
    }
    expect(service.getOwnerStructuredPressConference(firstId)).toMatchObject({ ok: true, data: { status: "COMPLETED" } });

    // Same tick, unchanged facts, already completed — must not reroll/resurrect.
    for (let i = 0; i < 5; i += 1) {
      expect(service.evaluateOwnerBusinessPress()).toMatchObject({ ok: true, data: undefined });
    }

    // A genuinely distinct real fact on the very same in-game date — a fresh
    // sponsorship with a DIFFERENT sponsor than any already-asked-about deal
    // — must get real coverage: a new interview identity, never silently
    // dropped in favour of the already-answered topic(s).
    const db2 = openGameDatabase(savePath);
    const economy = new ClubEconomyRepository(db2);
    const alreadySponsoredIds = new Set(economy.sponsorships(realClubId).map((item) => item.sponsorId));
    const newSponsor = economy.sponsors().find((item) => !alreadySponsoredIds.has(item.id))!;
    expect(newSponsor).toBeDefined();
    // A day later than the founding sponsorship's own startDate: "latest
    // fact wins" (ownerCandidates) ties on an exactly-equal startDate by
    // internal array order, which is a test-only degenerate case (a fresh
    // world-gen club's founding sponsorship and a same-tick new one sharing
    // one literal calendar date) — real gameplay signings are never dated
    // identically to the club's own founding day. One real day apart is
    // still "close together," proving the same "don't dedupe by date alone,
    // use fact identity" behaviour without that tie.
    economy.upsertSponsorship({
      id: "dedupe-owner-sponsorship" as EntityId,
      clubId: realClubId,
      sponsorId: newSponsor.id,
      type: "SHIRT_SECONDARY",
      startDate: nextDay(created.data.save.worldDate),
      endDate: "2029-01-01",
      annualValue: 500_000,
      bonuses: {},
      currency: "NPR",
      status: "ACTIVE",
      provenanceStatus: "SIMULATION_ONLY",
    });
    db2.close();

    const secondIds = new Set<EntityId>();
    for (let i = 0; i < 5; i += 1) {
      const evaluated = service.evaluateOwnerBusinessPress();
      expect(evaluated.ok).toBe(true);
      if (evaluated.ok && evaluated.data) secondIds.add(evaluated.data.interviewId);
    }
    expect(secondIds.size).toBe(1);
    const secondId = [...secondIds][0]!;
    expect(secondId).not.toBe(firstId);
    for (let guard = 0; guard < 4; guard += 1) {
      const view = service.getOwnerStructuredPressConference(secondId);
      expect(view.ok).toBe(true);
      if (!view.ok || view.data.status === "COMPLETED") break;
      expect(view.data.currentQuestion?.prompt).toMatch(/agreement|commercial/i);
      const stance = view.data.currentQuestion?.options[0]?.stance;
      expect(service.answerOwnerStructuredPressQuestion({ interviewId: secondId, stance: stance! }).ok).toBe(true);
    }
    expect(service.getOwnerStructuredPressConference(secondId)).toMatchObject({ ok: true, data: { status: "COMPLETED" } });

    // Exactly two OWNER_BUSINESS interview rows ever — one per real distinct
    // event, never more, regardless of how many topics each bundled.
    const db3 = openGameDatabase(savePath);
    expect(new MediaPhaseBRepository(db3).interviews().filter((item) => item.context === "OWNER_BUSINESS").length).toBe(2);
    db3.close();

    // Save/reload: re-evaluating the same two now-completed facts after a
    // full reload must not duplicate or reopen either one.
    expect(service.saveCareer().ok).toBe(true);
    service.closeCareer();
    expect(service.loadCareer(saveId).ok).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      expect(service.evaluateOwnerBusinessPress()).toMatchObject({ ok: true, data: undefined });
    }
    const db4 = openGameDatabase(savePath);
    expect(new MediaPhaseBRepository(db4).interviews().filter((item) => item.context === "OWNER_BUSINESS").length).toBe(2);
    db4.close();
    service.closeCareer();
  });
});

describe("press dedupe and follow-up — FEDERATION_GOVERNANCE", () => {
  it("suppresses an unchanged fact, gives a distinct same-day fact (project + coach appointment) real coverage, and survives save/reload", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "dedupe-president-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data[0]!;
    const created = service.createCareer({
      saveName: "Dedupe President",
      joinTeamId: club.teamId,
      character,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    const saveId = created.data.save.id;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    migrateDatabase(db);
    const personId = (
      db.prepare("SELECT person_id FROM career_characters WHERE id = ?").get(created.data.save.playerCharacterId!) as {
        person_id: EntityId;
      }
    ).person_id;
    const managerClub = db
      .prepare("SELECT club_id FROM manager_contracts WHERE person_id = ? AND status = 'ACTIVE'")
      .get(personId) as { club_id: EntityId };
    const federationId = (
      db
        .prepare("SELECT f.id FROM federations f JOIN clubs c ON c.country_id = f.country_id WHERE c.id = ? LIMIT 1")
        .get(managerClub.club_id) as { id: EntityId }
    ).id;
    const now = created.data.save.worldDate;
    db.prepare(
      `INSERT INTO federation_leadership_tenures
       (id,person_id,federation_id,role,term_start,term_end,status,provenance_status)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run("dedupe-president-tenure", personId, federationId, "FEDERATION_PRESIDENT", now, "2030-01-01", "ACTIVE", "SIMULATION_ONLY");
    const project = createFederationProject(db, {
      federationId,
      projectType: "NATIONAL_TRAINING_CENTRE",
      name: "National Training Centre",
      date: now,
      seed: "dedupe-president-project",
    });
    new FederationGovernanceRepository(db).upsertProject({ ...project, status: "CONSTRUCTION" });
    db.close();
    expect(service.loadCareer(saveId).ok).toBe(true);
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({ ok: true });

    const firstIds = new Set<EntityId>();
    for (let i = 0; i < 5; i += 1) {
      const evaluated = service.evaluatePresidentPress();
      expect(evaluated.ok).toBe(true);
      if (evaluated.ok && evaluated.data) firstIds.add(evaluated.data.interviewId);
    }
    expect(firstIds.size).toBe(1);
    const firstId = [...firstIds][0]!;
    const firstView = service.evaluatePresidentPress();
    const firstStance = firstView.ok ? firstView.data?.currentQuestion?.options[0]?.stance : undefined;
    expect(firstStance).toBeDefined();
    expect(service.answerPresidentStructuredPressQuestion({ interviewId: firstId, stance: firstStance! }).ok).toBe(true);

    for (let i = 0; i < 5; i += 1) {
      expect(service.evaluatePresidentPress()).toMatchObject({ ok: true, data: undefined });
    }

    // A distinct real fact same day: a national-team head-coach appointment.
    const db2 = openGameDatabase(savePath);
    const team = db2
      .prepare("SELECT id FROM teams WHERE federation_id = ? LIMIT 1")
      .get(federationId) as { id: EntityId };
    const coachPerson = db2
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId };
    db2.prepare(
      `INSERT INTO staff_appointments (id, person_id, organisation_type, team_id, role, start_date, employment_status)
       VALUES (?, ?, 'NATIONAL_TEAM', ?, 'NATIONAL_TEAM_HEAD_COACH', ?, 'ACTIVE')`,
    ).run("dedupe-president-coach", coachPerson.id, team.id, created.data.save.worldDate);
    db2.close();

    const secondIds = new Set<EntityId>();
    for (let i = 0; i < 5; i += 1) {
      const evaluated = service.evaluatePresidentPress();
      expect(evaluated.ok).toBe(true);
      if (evaluated.ok && evaluated.data) secondIds.add(evaluated.data.interviewId);
    }
    expect(secondIds.size).toBe(1);
    const secondId = [...secondIds][0]!;
    expect(secondId).not.toBe(firstId);
    const secondView = service.evaluatePresidentPress();
    const secondStance = secondView.ok ? secondView.data?.currentQuestion?.options[0]?.stance : undefined;
    expect(
      service.answerPresidentStructuredPressQuestion({ interviewId: secondId, stance: secondStance! }).ok,
    ).toBe(true);

    const db3 = openGameDatabase(savePath);
    expect(
      new MediaPhaseBRepository(db3).interviews().filter((item) => item.context === "FEDERATION_GOVERNANCE").length,
    ).toBe(2);
    db3.close();

    expect(service.saveCareer().ok).toBe(true);
    service.closeCareer();
    expect(service.loadCareer(saveId).ok).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      expect(service.evaluatePresidentPress()).toMatchObject({ ok: true, data: undefined });
    }
    const db4 = openGameDatabase(savePath);
    expect(
      new MediaPhaseBRepository(db4).interviews().filter((item) => item.context === "FEDERATION_GOVERNANCE").length,
    ).toBe(2);
    db4.close();
    service.closeCareer();
  });
});

describe("press dedupe and follow-up — Manager TRANSFER/PLAYER_ISSUE", () => {
  it("suppresses a still-unresolved active bid across repeated same-context requests (same tick and next-day), never duplicating", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "dedupe-manager-transfer-stable-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data[0]!;
    const created = service.createCareer({ careerMode: "MANAGER", saveName: "Dedupe Manager Transfer", joinTeamId: club.teamId, character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(club.teamId) as { club_id: EntityId }).club_id;
    const player = db
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId };
    const otherClub = db.prepare("SELECT id FROM clubs WHERE id != ? LIMIT 1").get(clubId) as { id: EntityId };
    new TransferMarketRepository(db).upsertPlayerContract({
      id: "dedupe-transfer-player-contract" as EntityId,
      playerId: player.id,
      clubId,
      startDate: "2026-01-01",
      endDate: "2028-01-01",
      contractType: "PERMANENT",
      salary: 50_000,
      appearanceFee: 0,
      goalBonus: 0,
      cleanSheetBonus: 0,
      signingBonus: 0,
      loyaltyBonus: 0,
      currency: "NPR",
      squadRole: "ROTATION",
      status: "ACTIVE",
      provenance: { sourceName: "SIMULATION_ONLY", confidence: 1, status: "SIMULATION_ONLY" },
    });
    new TransferMarketRepository(db).insertTransferOffer({
      id: "dedupe-transfer-offer" as EntityId,
      buyingClubId: otherClub.id,
      sellingClubId: clubId,
      playerId: player.id,
      offerType: "PERMANENT",
      transferFee: 100_000,
      installments: 1,
      addOns: 0,
      sellOnPercentage: 0,
      submittedAt: created.data.save.worldDate,
      expiresAt: "2027-01-01",
      status: "SUBMITTED",
      currency: "NPR",
      agentFee: 0,
      signingFee: 0,
    });
    db.close();
    expect(service.loadCareer(created.data.save.id).ok).toBe(true);

    const ids = new Set<EntityId>();
    for (let i = 0; i < 3; i += 1) {
      const requested = service.requestStructuredPressConference({ context: "TRANSFER" });
      expect(requested.ok).toBe(true);
      if (requested.ok) ids.add(requested.data.interviewId);
    }
    expect(ids.size).toBe(1);
    const interviewId = [...ids][0]!;
    const view = service.getStructuredPressConference(interviewId);
    const stance = view.ok ? view.data.currentQuestion?.options.find((o) => o.stance === "COMMIT")?.stance : undefined;
    expect(stance).toBe("COMMIT");
    expect(service.answerStructuredPressQuestion({ interviewId, stance: "COMMIT" }).ok).toBe(true);

    // Next day, the SAME bid is still SUBMITTED (nothing has materially
    // changed) — a fresh request must resolve back to the same completed
    // interview, never generate a second one, cooldown or not.
    const followUp = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(followUp.ok).toBe(true);
    if (followUp.ok) expect(followUp.data.interviewId).toBe(interviewId);

    const dbCheck = openGameDatabase(savePath);
    expect(
      new MediaPhaseBRepository(dbCheck).interviews().filter((item) => item.context === "TRANSFER").length,
    ).toBe(1);
    dbCheck.close();
    service.closeCareer();
  });

  it("a genuine TRANSFER state transition (SUBMITTED -> COMPLETED) creates a real follow-up interview even within the cooldown window", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "dedupe-manager-transfer-followup-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data[0]!;
    const created = service.createCareer({ careerMode: "MANAGER", saveName: "Dedupe Manager Followup", joinTeamId: club.teamId, character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(club.teamId) as { club_id: EntityId }).club_id;
    const player = db
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId };
    const otherClub = db.prepare("SELECT id FROM clubs WHERE id != ? LIMIT 1").get(clubId) as { id: EntityId };
    new TransferMarketRepository(db).upsertPlayerContract({
      id: "followup-transfer-player-contract" as EntityId,
      playerId: player.id,
      clubId,
      startDate: "2026-01-01",
      endDate: "2028-01-01",
      contractType: "PERMANENT",
      salary: 50_000,
      appearanceFee: 0,
      goalBonus: 0,
      cleanSheetBonus: 0,
      signingBonus: 0,
      loyaltyBonus: 0,
      currency: "NPR",
      squadRole: "ROTATION",
      status: "ACTIVE",
      provenance: { sourceName: "SIMULATION_ONLY", confidence: 1, status: "SIMULATION_ONLY" },
    });
    new TransferMarketRepository(db).insertTransferOffer({
      id: "followup-transfer-offer" as EntityId,
      buyingClubId: otherClub.id,
      sellingClubId: clubId,
      playerId: player.id,
      offerType: "PERMANENT",
      transferFee: 100_000,
      installments: 1,
      addOns: 0,
      sellOnPercentage: 0,
      submittedAt: created.data.save.worldDate,
      expiresAt: "2027-01-01",
      status: "SUBMITTED",
      currency: "NPR",
      agentFee: 0,
      signingFee: 0,
    });
    db.close();
    expect(service.loadCareer(created.data.save.id).ok).toBe(true);

    const first = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(service.answerStructuredPressQuestion({ interviewId: first.data.interviewId, stance: "COMMIT" }).ok).toBe(true);

    // One day later (well inside the 3-day cooldown) the offer genuinely
    // completes — a materially new fact, not a repeat of the same state.
    service.closeCareer();
    const db2 = openGameDatabase(savePath);
    new TransferMarketRepository(db2).updateOfferStatus("followup-transfer-offer" as EntityId, "COMPLETED");
    db2.prepare("UPDATE saves SET world_date = ? WHERE id = ?").run(nextDay(created.data.save.worldDate), created.data.save.id);
    db2.close();
    expect(service.loadCareer(created.data.save.id).ok).toBe(true);

    const followUp = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(followUp.ok).toBe(true);
    if (!followUp.ok) return;
    expect(followUp.data.interviewId).not.toBe(first.data.interviewId);
    expect(followUp.data.status).toBe("OPEN");
    expect(followUp.data.currentQuestion?.prompt).toMatch(/leave/i);
    expect(
      service.answerStructuredPressQuestion({ interviewId: followUp.data.interviewId, stance: "CALM" }).ok,
    ).toBe(true);

    const dbCheck = openGameDatabase(savePath);
    const interviews = new MediaPhaseBRepository(dbCheck).interviews().filter((item) => item.context === "TRANSFER");
    expect(interviews.length).toBe(2);
    expect(interviews.every((item) => item.status === "COMPLETED")).toBe(true);
    dbCheck.close();
    service.closeCareer();
  });

  it("a genuine PLAYER_ISSUE state transition (playing-time concern -> a distinct captaincy concern) creates a real follow-up interview within the cooldown window", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "dedupe-manager-playerissue-followup-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = service.listStartingClubs();
    expect(clubs.ok).toBe(true);
    if (!clubs.ok) return;
    const club = clubs.data[0]!;
    const created = service.createCareer({ careerMode: "MANAGER", saveName: "Dedupe Manager PlayerIssue", joinTeamId: club.teamId, character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    const player = db
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId };
    new SquadDynamicsRepository(db).upsertConcern({
      id: "followup-playing-time-concern" as EntityId,
      personId: player.id,
      teamId: club.teamId,
      type: "PLAYING_TIME",
      status: "ACTIVE",
      severity: 5,
      raisedOn: created.data.save.worldDate,
      updatedOn: created.data.save.worldDate,
    });
    db.close();
    expect(service.loadCareer(created.data.save.id).ok).toBe(true);

    const first = service.requestStructuredPressConference({ context: "PLAYER_ISSUE" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.currentQuestion?.prompt).toMatch(/played much/i);
    expect(service.answerStructuredPressQuestion({ interviewId: first.data.interviewId, stance: "COMMIT" }).ok).toBe(true);

    // One day later, a distinct real concern arises — a captaincy demand —
    // still well inside the TRANSFER/PLAYER_ISSUE cooldown window.
    service.closeCareer();
    const db2 = openGameDatabase(savePath);
    new SquadDynamicsRepository(db2).upsertDemand({
      id: "followup-captaincy-demand" as EntityId,
      personId: player.id,
      teamId: club.teamId,
      type: "CAPTAINCY_CONCERN",
      status: "OPEN",
      severity: 5,
      openedOn: created.data.save.worldDate,
      updatedOn: created.data.save.worldDate,
      trigger: "Passed over for the captaincy",
      requestedOutcome: "A clear explanation from the manager",
    });
    db2.prepare("UPDATE saves SET world_date = ? WHERE id = ?").run(nextDay(created.data.save.worldDate), created.data.save.id);
    db2.close();
    expect(service.loadCareer(created.data.save.id).ok).toBe(true);

    const followUp = service.requestStructuredPressConference({ context: "PLAYER_ISSUE" });
    expect(followUp.ok).toBe(true);
    if (!followUp.ok) return;
    expect(followUp.data.interviewId).not.toBe(first.data.interviewId);
    expect(followUp.data.status).toBe("OPEN");
    expect(followUp.data.currentQuestion?.prompt).toMatch(/captaincy/i);
    expect(
      service.answerStructuredPressQuestion({ interviewId: followUp.data.interviewId, stance: "CALM" }).ok,
    ).toBe(true);

    const dbCheck = openGameDatabase(savePath);
    const interviews = new MediaPhaseBRepository(dbCheck).interviews().filter((item) => item.context === "PLAYER_ISSUE");
    expect(interviews.length).toBe(2);
    dbCheck.close();
    service.closeCareer();
  });
});

describe("press dedupe — role switch", () => {
  it("Manager <-> Owner <-> President for the same person: switching away and back never duplicates an open or completed interview", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "dedupe-role-switch-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const created = service.createCareer({
      saveName: "Role Switch Dedupe",
      character: {
        fullName: "Maya Adhikari",
        preferredDisplayName: "Maya",
        dateOfBirth: "1993-05-12",
        startingAge: 33,
        languages: ["ne", "en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "YOUTH_COACH",
        businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const saveId = created.data.save.id;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    migrateDatabase(db);
    const personId = (
      db.prepare("SELECT person_id FROM career_characters WHERE id = ?").get(created.data.save.playerCharacterId!) as {
        person_id: EntityId;
      }
    ).person_id;
    const managerClub = db
      .prepare("SELECT club_id FROM manager_contracts WHERE person_id = ? AND status = 'ACTIVE'")
      .get(personId) as { club_id: EntityId };
    const federation = db
      .prepare("SELECT f.id FROM federations f JOIN clubs c ON c.country_id = f.country_id WHERE c.id = ? LIMIT 1")
      .get(managerClub.club_id) as { id: EntityId };
    const now = created.data.save.worldDate;
    db.prepare(
      `INSERT INTO club_ownership_stakes
       (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,end_date,status,ownership_model,provenance_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("role-switch-dedupe-owner", managerClub.club_id, "PERSON", personId, "Maya Adhikari", "MAJORITY_OWNER", 75, 75, now, null, "ACTIVE", "PARTIALLY_BUYABLE", "SIMULATION_ONLY");
    db.prepare(
      `INSERT INTO federation_leadership_tenures
       (id,person_id,federation_id,role,term_start,term_end,status,provenance_status)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run("role-switch-dedupe-president", personId, federation.id, "FEDERATION_PRESIDENT", now, "2030-01-01", "ACTIVE", "SIMULATION_ONLY");
    new ClubEconomyRepository(db).upsertInfrastructureProject({
      id: "role-switch-owner-project" as EntityId,
      clubId: managerClub.club_id,
      projectType: "STAND",
      planningStart: "2026-01-01",
      expectedCompletion: "2027-01-01",
      capitalCost: 5_000_000,
      ongoingCost: 100_000,
      currency: "NPR",
      status: "APPROVED",
      financingJson: {},
      provenanceStatus: "SIMULATION_ONLY",
    });
    const project = createFederationProject(db, {
      federationId: federation.id,
      projectType: "NATIONAL_TRAINING_CENTRE",
      name: "National Training Centre",
      date: now,
      seed: "role-switch-dedupe-project",
    });
    new FederationGovernanceRepository(db).upsertProject({ ...project, status: "CONSTRUCTION" });
    db.close();

    expect(service.loadCareer(saveId).ok).toBe(true);
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true });
    const ownerFirst = service.evaluateOwnerBusinessPress();
    expect(ownerFirst.ok && ownerFirst.data).toBeDefined();
    const ownerInterviewId = ownerFirst.ok ? ownerFirst.data!.interviewId : undefined;

    // Away to Manager, and back — the open Owner interview must resolve to
    // the exact same id, never a duplicate.
    expect(service.switchActiveCareerRole("MANAGER")).toMatchObject({ ok: true });
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true });
    const ownerAgain = service.evaluateOwnerBusinessPress();
    expect(ownerAgain.ok && ownerAgain.data?.interviewId).toBe(ownerInterviewId);

    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({ ok: true });
    const presidentFirst = service.evaluatePresidentPress();
    expect(presidentFirst.ok && presidentFirst.data).toBeDefined();
    const presidentInterviewId = presidentFirst.ok ? presidentFirst.data!.interviewId : undefined;

    expect(service.switchActiveCareerRole("MANAGER")).toMatchObject({ ok: true });
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({ ok: true });
    const presidentAgain = service.evaluatePresidentPress();
    expect(presidentAgain.ok && presidentAgain.data?.interviewId).toBe(presidentInterviewId);

    const dbCheck = openGameDatabase(savePath);
    const repo = new MediaPhaseBRepository(dbCheck);
    expect(repo.interviews().filter((item) => item.context === "OWNER_BUSINESS").length).toBe(1);
    expect(repo.interviews().filter((item) => item.context === "FEDERATION_GOVERNANCE").length).toBe(1);
    dbCheck.close();
    service.closeCareer();
  });

  it("Manager <-> Sporting Director for the same person: switching away and back never duplicates an open RECRUITMENT interview", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "dedupe-role-switch-sd-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const created = service.createCareer({ saveName: "Role Switch SD Dedupe", character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const saveId = created.data.save.id;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    const save = db.prepare("SELECT id, player_character_id, world_date FROM saves LIMIT 1").get() as {
      id: EntityId;
      player_character_id: EntityId;
      world_date: string;
    };
    const personId = (
      db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as {
        person_id: EntityId;
      }
    ).person_id;
    const clubId = (
      db
        .prepare(
          "SELECT t.club_id AS club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE' LIMIT 1",
        )
        .get(personId) as { club_id: EntityId }
    ).club_id;
    const appointmentId = "role-switch-sd-appointment";
    db.prepare(
      `INSERT INTO staff_appointments (id, person_id, organisation_type, club_id, role, start_date, employment_status)
       VALUES (?, ?, 'CLUB', ?, 'SPORTING_DIRECTOR', ?, 'ACTIVE')`,
    ).run(appointmentId, personId, clubId, save.world_date);
    db.prepare(
      `INSERT INTO club_executive_roles (id, club_id, role, person_id, appointment_id, status, assigned_on, provenance_status)
       VALUES (?, ?, 'SPORTING_DIRECTOR', ?, ?, 'FILLED', ?, 'SIMULATION_ONLY')`,
    ).run("role-switch-sd-execrole", clubId, personId, appointmentId, save.world_date);
    assignResponsibility(db, { worldDate: save.world_date } as never, clubId, "TRANSFERS", "STAFF", appointmentId as EntityId);
    const otherClub = db.prepare("SELECT id FROM clubs WHERE id != ? LIMIT 1").get(clubId) as { id: EntityId };
    const player = db
      .prepare("SELECT player_id FROM player_contracts WHERE club_id=? AND status='ACTIVE' LIMIT 1")
      .get(clubId) as { player_id: EntityId };
    new TransferMarketRepository(db).insertTransferOffer({
      id: "role-switch-sd-offer" as EntityId,
      buyingClubId: clubId,
      sellingClubId: otherClub.id,
      playerId: player.player_id,
      offerType: "PERMANENT",
      transferFee: 500_000,
      installments: 1,
      addOns: 0,
      sellOnPercentage: 0,
      submittedAt: save.world_date,
      expiresAt: save.world_date,
      status: "COMPLETED",
      currency: "NPR",
      agentFee: 0,
      signingFee: 0,
    });
    db.close();

    expect(service.loadCareer(saveId).ok).toBe(true);
    // SPORTING_DIRECTOR is an NPC job: reached through the held appointment,
    // never a career switch — the active role stays MANAGER throughout.
    const sdFirst = service.evaluateSportingDirectorPress();
    expect(sdFirst.ok && sdFirst.data).toBeDefined();
    const sdInterviewId = sdFirst.ok ? sdFirst.data!.interviewId : undefined;

    const sdAgain = service.evaluateSportingDirectorPress();
    expect(sdAgain.ok && sdAgain.data?.interviewId).toBe(sdInterviewId);

    const dbCheck = openGameDatabase(savePath);
    expect(
      new MediaPhaseBRepository(dbCheck).interviews().filter((item) => item.context === "RECRUITMENT").length,
    ).toBe(1);
    dbCheck.close();
    service.closeCareer();
  });
});
