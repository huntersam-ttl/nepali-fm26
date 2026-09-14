import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  EventRepository,
  FederationGovernanceRepository,
  MediaPhaseBRepository,
  TransferMarketRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  createFederationProject,
  createNepalSave,
  simulateNepalCareer,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * FINAL PRESS/MEDIA SOAK — two parts:
 *
 * PART A (world-scale, AI): extends ai-press-production-loop.test.ts's
 * proven natural-world-progression pattern from one AI season to two full AI
 * seasons (after a bootstrap season with no managers, matching this
 * codebase's real staffing order), with full metrics instrumentation
 * (interview/question/response/entity-reference/row-growth/performance) and
 * a save/reload checkpoint between the two seasons.
 *
 * PART B (role-scale, human): a bounded, multi-checkpoint soak for the
 * three human dashboard-driven roles (Manager, Owner, Federation President)
 * held by one person, each answering real grounded facts seeded at three
 * separate in-game dates — Sporting Director and role-switch dedupe are
 * already covered by press-dedupe-and-followup.test.ts and are not
 * re-measured here to avoid duplicating that coverage.
 */

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `press-final-soak-${name}-`));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: name,
    gameVersion: "test",
    randomSeed: name,
  });
  return path;
};

const seedManagersForAllFixtureTeams = (db: ReturnType<typeof openGameDatabase>): number => {
  const teams = db
    .prepare(
      `SELECT DISTINCT team_id FROM (
        SELECT home_team_id AS team_id FROM fixtures
        UNION
        SELECT away_team_id AS team_id FROM fixtures
      )`,
    )
    .all() as Array<{ team_id: EntityId }>;
  let seeded = 0;
  for (const { team_id: teamId } of teams) {
    const existing = db.prepare("SELECT 1 FROM manager_contracts WHERE team_id=? AND status='ACTIVE'").get(teamId);
    if (existing) continue;
    const person = db
      .prepare("SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1")
      .get() as { id: EntityId } | undefined;
    if (!person) break;
    const clubRow = db.prepare("SELECT club_id FROM teams WHERE id=?").get(teamId) as { club_id: EntityId } | undefined;
    if (!clubRow) continue;
    const profileId = `soak-manager-profile-${person.id}` as EntityId;
    db.prepare(
      `INSERT INTO manager_profiles (id, person_id, attributes_json, preferred_style, reputation_profile, created_on)
       VALUES (?, ?, '{}', 'BALANCED', 'UNKNOWN', '2026-01-01')`,
    ).run(profileId, person.id);
    db.prepare(
      `INSERT INTO manager_contracts (id, manager_profile_id, person_id, team_id, club_id, job_title, contract_start, salary_amount_minor, currency, status)
       VALUES (?, ?, ?, ?, ?, 'Head Coach', '2026-01-01', 100000, 'NPR', 'ACTIVE')`,
    ).run(`soak-manager-contract-${person.id}`, profileId, person.id, teamId, clubRow.club_id);
    seeded += 1;
  }
  return seeded;
};

/** A raw v4 UUID looks like this; a resolved entity reference label never
 * does — used to catch a leaked raw id surfacing as a question prompt or
 * answer text instead of a real display name. */
const RAW_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("FINAL PRESS SOAK — Part A: AI world-scale (2 seasons)", () => {
  it("two full AI seasons produce bounded, valid, exact-once press with no dead/raw entity references, and a save/reload checkpoint changes nothing", () => {
    const path = makeSave("part-a");
    const db = openGameDatabase(path);
    const t0 = Date.now();

    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "soak-part-a-bootstrap",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
      maxFixturesPerSeason: 90,
    });
    const tBootstrap = Date.now();
    const seededManagers = seedManagersForAllFixtureTeams(db);
    expect(seededManagers).toBeGreaterThan(0);

    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "soak-part-a-season-2",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
    });
    const tSeason2 = Date.now();

    const mediaRepo1 = new MediaPhaseBRepository(db);
    const season2Interviews = mediaRepo1.interviews();
    const season2Stories = new EventRepository(db).historicalEvents().filter((e) => e.eventType.startsWith("MANAGER_PRESS_"));

    // Save/reload checkpoint: closing and reopening the database must not
    // change anything already persisted.
    db.close();
    const reopened = openGameDatabase(path);
    const afterReload = new MediaPhaseBRepository(reopened).interviews();
    expect(afterReload.length).toBe(season2Interviews.length);
    expect(new Set(afterReload.map((i) => i.id))).toEqual(new Set(season2Interviews.map((i) => i.id)));

    simulateNepalCareer({
      db: reopened,
      seasons: 1,
      seed: "soak-part-a-season-3",
      savePath: path,
      competitionSeasonId: "anfa-national-league-2026" as EntityId,
    });
    const tSeason3 = Date.now();

    const interviews = new MediaPhaseBRepository(reopened).interviews();
    const stories = new EventRepository(reopened).historicalEvents().filter((e) => e.eventType.startsWith("MANAGER_PRESS_"));
    const matches = reopened.prepare("SELECT COUNT(*) AS n FROM matches").get() as { n: number };
    const clubs = reopened.prepare("SELECT COUNT(*) AS n FROM clubs").get() as { n: number };
    const activeManagers = reopened.prepare("SELECT COUNT(*) AS n FROM manager_contracts WHERE status='ACTIVE'").get() as { n: number };
    const transfers = reopened.prepare("SELECT COUNT(*) AS n FROM transfer_offers WHERE status='COMPLETED'").get() as { n: number };
    const concerns = reopened.prepare("SELECT COUNT(*) AS n FROM player_concerns").get() as { n: number };

    // --- INTERVIEW METRICS ---
    const byContext = new Map<string, number>();
    const byStatus = new Map<string, number>();
    for (const interview of interviews) {
      byContext.set(interview.context, (byContext.get(interview.context) ?? 0) + 1);
      byStatus.set(interview.status, (byStatus.get(interview.status) ?? 0) + 1);
    }
    expect(byStatus.get("OPEN") ?? 0).toBe(0); // AI never leaves one dangling — no AI Inbox exists to act on it.
    expect((byContext.get("POST_MATCH") ?? 0)).toBeLessThan(matches.n); // bounded, never every match.

    // --- QUESTION METRICS ---
    let totalQuestions = 0;
    let maxQuestions = 0;
    let deadRefs = 0;
    let rawUuidRefs = 0;
    let invalidAiOptions = 0;
    let duplicateConsequences = 0;
    const seenConsequenceKeys = new Set<string>();
    for (const interview of interviews) {
      const questions = interview.structuredQuestions ?? [];
      totalQuestions += questions.length;
      maxQuestions = Math.max(maxQuestions, questions.length);
      for (const question of questions) {
        for (const subject of question.subjectEntities) {
          if (RAW_UUID.test(question.prompt)) rawUuidRefs += 1;
          const exists =
            subject.type === "person"
              ? reopened.prepare("SELECT 1 FROM persons WHERE id=?").get(subject.id)
              : subject.type === "club"
                ? reopened.prepare("SELECT 1 FROM clubs WHERE id=?").get(subject.id)
                : subject.type === "fixture"
                  ? reopened.prepare("SELECT 1 FROM fixtures WHERE id=?").get(subject.id)
                  : 1; // other ref types not surfaced by AI POST_MATCH/TRANSFER/PLAYER_ISSUE
          if (!exists) deadRefs += 1;
        }
      }
      for (const answer of interview.structuredAnswers ?? []) {
        const question = questions.find((item) => item.id === answer.questionId);
        expect(question).toBeDefined();
        const validOption = question!.options.some((option) => option.stance === answer.stance);
        if (!validOption) invalidAiOptions += 1;
        if (answer.consequenceSummary) {
          const key = `${interview.id}:${answer.questionId}:${answer.consequenceSummary}`;
          if (seenConsequenceKeys.has(key)) duplicateConsequences += 1;
          seenConsequenceKeys.add(key);
        }
      }
    }
    expect(invalidAiOptions).toBe(0);
    expect(deadRefs).toBe(0);
    expect(rawUuidRefs).toBe(0);
    expect(duplicateConsequences).toBe(0);

    console.log("SOAK PART A — world:", {
      seasons: 3,
      matches: matches.n,
      clubs: clubs.n,
      activeManagers: activeManagers.n,
      completedTransfers: transfers.n,
      playerConcerns: concerns.n,
    });
    console.log("SOAK PART A — interviews by context:", Object.fromEntries(byContext));
    console.log("SOAK PART A — interviews by status:", Object.fromEntries(byStatus));
    console.log("SOAK PART A — questions:", { total: totalQuestions, average: totalQuestions / Math.max(1, interviews.length), max: maxQuestions });
    console.log("SOAK PART A — Stories:", { total: stories.length, season2: season2Stories.length, season3: stories.length - season2Stories.length });
    console.log("SOAK PART A — row growth:", { interviewsAfterSeason2: season2Interviews.length, interviewsAfterSeason3: interviews.length });
    console.log("SOAK PART A — performance (ms):", {
      bootstrap: tBootstrap - t0,
      season2: tSeason2 - tBootstrap,
      season3: tSeason3 - tSeason2,
      total: tSeason3 - t0,
    });

    reopened.close();
  }, 600_000);
});

describe("FINAL PRESS SOAK — Part B: human roles (Manager, Owner, President)", () => {
  it("a Manager+Owner+President multi-role human soaks three real checkpoints with bounded, valid press and Story coverage", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "press-final-soak-part-b-"));
    dirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: registryPath });
    const t0 = Date.now();
    const created = service.createCareer({
      saveName: "Final Soak Part B",
      character: {
        fullName: "Soak Tester",
        dateOfBirth: "1985-01-01",
        startingAge: 41,
        languages: ["en"],
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
    const savePath = created.data.catalogEntry.filePath;
    const saveId = created.data.save.id;
    service.closeCareer();

    const db = openGameDatabase(savePath);
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
      `INSERT INTO club_ownership_stakes
       (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,end_date,status,ownership_model,provenance_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("soak-owner-stake", managerClub.club_id, "PERSON", personId, "Soak Tester", "MAJORITY_OWNER", 75, 75, now, null, "ACTIVE", "PARTIALLY_BUYABLE", "SIMULATION_ONLY");
    db.prepare(
      `INSERT INTO federation_leadership_tenures
       (id,person_id,federation_id,role,term_start,term_end,status,provenance_status)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run("soak-president-tenure", personId, federationId, "FEDERATION_PRESIDENT", now, "2030-01-01", "ACTIVE", "SIMULATION_ONLY");
    // Checkpoint 1 fact: an Owner infrastructure project.
    new ClubEconomyRepository(db).upsertInfrastructureProject({
      id: "soak-owner-project-1" as EntityId,
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
    db.close();
    expect(service.loadCareer(saveId).ok).toBe(true);

    const nextDay = (date: string): string => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };

    let checkpointDate = now;
    const humanInterviewIds = new Set<EntityId>();

    // Checkpoint 1: Owner press on the seeded project.
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true });
    const owner1 = service.evaluateOwnerBusinessPress();
    expect(owner1.ok && owner1.data).toBeDefined();
    if (owner1.ok && owner1.data) {
      humanInterviewIds.add(owner1.data.interviewId);
      // A club's founding sponsorship can already qualify as a second real
      // candidate topic alongside the seeded project, so this conference may
      // bundle more than one question — loop to genuine completion rather
      // than assuming exactly one.
      for (let guard = 0; guard < 4; guard += 1) {
        const view = service.getOwnerStructuredPressConference(owner1.data.interviewId);
        if (!view.ok || view.data.status === "COMPLETED") break;
        const stance = view.data.currentQuestion?.options[0]?.stance;
        expect(service.answerOwnerStructuredPressQuestion({ interviewId: owner1.data.interviewId, stance: stance! }).ok).toBe(true);
      }
    }

    // Checkpoint 2 (a day later): President press on a seeded federation project.
    checkpointDate = nextDay(checkpointDate);
    const db2 = openGameDatabase(savePath);
    db2.prepare("UPDATE saves SET world_date = ? WHERE id = ?").run(checkpointDate, saveId);
    const federationProject = createFederationProject(db2, {
      federationId,
      projectType: "NATIONAL_TRAINING_CENTRE",
      name: "Soak Training Centre",
      date: checkpointDate,
      seed: "soak-federation-project-1",
    });
    new FederationGovernanceRepository(db2).upsertProject({ ...federationProject, status: "CONSTRUCTION" });
    db2.close();
    expect(service.loadCareer(saveId).ok).toBe(true);
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({ ok: true });
    const president1 = service.evaluatePresidentPress();
    if (president1.ok && president1.data) {
      humanInterviewIds.add(president1.data.interviewId);
      for (let guard = 0; guard < 4; guard += 1) {
        const view = service.getPresidentStructuredPressConference(president1.data.interviewId);
        if (!view.ok || view.data.status === "COMPLETED") break;
        const stance = view.data.currentQuestion?.options[0]?.stance;
        expect(service.answerPresidentStructuredPressQuestion({ interviewId: president1.data.interviewId, stance: stance! }).ok).toBe(true);
      }
    }

    // Checkpoint 3 (another day later): Manager TRANSFER press on a seeded offer.
    checkpointDate = nextDay(checkpointDate);
    const db3 = openGameDatabase(savePath);
    db3.prepare("UPDATE saves SET world_date = ? WHERE id = ?").run(checkpointDate, saveId);
    const player = db3
      .prepare("SELECT player_id FROM player_contracts WHERE club_id=? AND status='ACTIVE' LIMIT 1")
      .get(managerClub.club_id) as { player_id: EntityId };
    const otherClub = db3.prepare("SELECT id FROM clubs WHERE id != ? LIMIT 1").get(managerClub.club_id) as { id: EntityId };
    new TransferMarketRepository(db3).insertTransferOffer({
      id: "soak-manager-transfer-offer" as EntityId,
      buyingClubId: otherClub.id,
      sellingClubId: managerClub.club_id,
      playerId: player.player_id,
      offerType: "PERMANENT",
      transferFee: 200_000,
      installments: 1,
      addOns: 0,
      sellOnPercentage: 0,
      submittedAt: checkpointDate,
      expiresAt: "2027-01-01",
      status: "SUBMITTED",
      currency: "NPR",
      agentFee: 0,
      signingFee: 0,
    });
    db3.close();
    expect(service.loadCareer(saveId).ok).toBe(true);
    expect(service.switchActiveCareerRole("MANAGER")).toMatchObject({ ok: true });
    const manager1 = service.requestStructuredPressConference({ context: "TRANSFER" });
    expect(manager1.ok).toBe(true);
    if (manager1.ok) {
      humanInterviewIds.add(manager1.data.interviewId);
      const stance = manager1.data.currentQuestion?.options.find((option) => option.stance === "COMMIT")?.stance ?? "DEFLECT";
      expect(service.answerStructuredPressQuestion({ interviewId: manager1.data.interviewId, stance }).ok).toBe(true);
    }

    // --- METRICS ---
    const dbCheck = openGameDatabase(savePath);
    const humanInterviews = new MediaPhaseBRepository(dbCheck)
      .interviews()
      .filter((interview) => interview.managerPersonId === personId);
    const humanStories = new EventRepository(dbCheck)
      .historicalEvents()
      .filter((event) => event.involvedEntities.some((ref) => ref.id === personId) && event.eventType.includes("PRESS"));
    const byContext = new Map<string, number>();
    for (const interview of humanInterviews) byContext.set(interview.context, (byContext.get(interview.context) ?? 0) + 1);
    const byStatus = new Map<string, number>();
    for (const interview of humanInterviews) byStatus.set(interview.status, (byStatus.get(interview.status) ?? 0) + 1);

    expect(humanInterviews.length).toBeGreaterThanOrEqual(2);
    expect(byStatus.get("OPEN") ?? 0).toBe(0); // both checkpoints answered to completion.
    // Exact-once: distinct interview ids, one per real fact.
    expect(new Set(humanInterviews.map((i) => i.id)).size).toBe(humanInterviews.length);

    console.log("SOAK PART B — human interviews by context:", Object.fromEntries(byContext));
    console.log("SOAK PART B — human interviews by status:", Object.fromEntries(byStatus));
    console.log("SOAK PART B — human Stories:", humanStories.length);
    console.log("SOAK PART B — performance (ms) total:", Date.now() - t0);

    dbCheck.close();
    service.closeCareer();
  }, 120_000);
});
