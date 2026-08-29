import {
  EventRepository,
  PlayerRepository,
  YouthRepository,
  ClubNetworkRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId, type YouthPartnershipDevelopmentProgramme } from "@nepal-football-sim/shared-types";
import { ageForPlayer } from "./youth-intake.js";

const PROGRAMME_DAYS = 45;
const MAX_PROGRAMMES_PER_CLUB_SEASON = 2;

const partnerClubExists = (db: GameDatabase, clubId: EntityId): boolean =>
  Boolean(db.prepare("SELECT 1 FROM clubs WHERE id=? LIMIT 1").get(clubId));

/** Preseason/annual planning entry point for temporary youth development. */
export const planYouthDevelopmentPartnerships = (
  db: GameDatabase,
  input: { clubId: EntityId; worldDate: string; maxProgrammes?: number },
): YouthPartnershipDevelopmentProgramme[] => {
  const networks = new ClubNetworkRepository(db);
  const partnerships = networks.activeYouthDevelopmentPartnerships(input.clubId, input.worldDate);
  if (partnerships.length === 0) return [];
  const youth = new YouthRepository(db);
  const year = input.worldDate.slice(0, 4);
  const used = youth.partnershipDevelopmentProgrammesForClub(input.clubId).filter((item) => item.startDate.startsWith(year)).length;
  const remaining = Math.max(0, Math.min(input.maxProgrammes ?? MAX_PROGRAMMES_PER_CLUB_SEASON, MAX_PROGRAMMES_PER_CLUB_SEASON) - used);
  if (remaining === 0) return [];
  const planned: YouthPartnershipDevelopmentProgramme[] = [];
  for (const status of youth.youthStatuses().filter((item) => item.clubId === input.clubId).sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    if (planned.length >= remaining || status.youthStatus === "FIRST_TEAM_PLAYER") continue;
    if (ageForPlayer(db, status.playerId, input.worldDate) > 18) continue;
    if (youth.activePartnershipDevelopmentForPlayer(status.playerId)) continue;
    const partnership = partnerships[planned.length % partnerships.length]!;
    if (!partnerClubExists(db, partnership.toClubId)) continue;
    const programme: YouthPartnershipDevelopmentProgramme = {
      id: createStableEntityId("youth-partnership-programme", `${input.clubId}:${status.playerId}:${partnership.id}:${input.worldDate}`),
      playerId: status.playerId,
      homeClubId: input.clubId,
      partnerClubId: partnership.toClubId,
      partnershipId: partnership.id,
      programmeType: "FOREIGN_YOUTH_DEVELOPMENT",
      startDate: input.worldDate,
      endDate: addDays(input.worldDate, PROGRAMME_DAYS),
      status: "ACTIVE",
      developmentApplied: false,
    };
    youth.upsertPartnershipDevelopmentProgramme(programme);
    planned.push(programme);
  }
  return planned;
};

/** Completes due programmes and applies one small, canonical development-state exposure signal. */
export const completeYouthDevelopmentPartnerships = (
  db: GameDatabase,
  worldDate: string,
): YouthPartnershipDevelopmentProgramme[] => {
  const youth = new YouthRepository(db);
  const players = new PlayerRepository(db);
  const completed: YouthPartnershipDevelopmentProgramme[] = [];
  for (const programme of youth.duePartnershipDevelopmentProgrammes(worldDate)) {
    if (programme.developmentApplied) continue;
    const status = youth.youthStatuses().find((item) => item.playerId === programme.playerId);
    if (!status || status.clubId !== programme.homeClubId) continue;
    const state = players.developmentState(programme.playerId);
    if (state) {
      players.upsertDevelopmentState({
        ...state,
        developmentMomentum: Math.min(100, state.developmentMomentum + 2),
        lastDevelopmentUpdate: worldDate,
      });
    }
    youth.insertYouthDevelopmentActivity({
      id: createStableEntityId("youth-activity", `${programme.id}:completed`),
      playerId: programme.playerId,
      clubId: programme.homeClubId,
      activityDate: worldDate,
      activityType: "FOREIGN_DEVELOPMENT_PROGRAMME",
      developmentMinutes: 540,
      exposureLevel: 0.18,
      data: { partnerClubId: programme.partnerClubId, programmeId: programme.id },
    });
    const finished = { ...programme, status: "COMPLETED" as const, developmentApplied: true, completedOn: worldDate };
    youth.upsertPartnershipDevelopmentProgramme(finished);
    new EventRepository(db).insertHistoricalEvent({
      id: createStableEntityId("history", `FOREIGN_DEVELOPMENT_PROGRAMME_COMPLETED:${programme.id}`),
      occurredOn: worldDate,
      eventType: "FOREIGN_DEVELOPMENT_PROGRAMME_COMPLETED",
      involvedEntities: [{ id: programme.playerId, type: "person" }, { id: programme.partnerClubId, type: "club" }],
      title: "Foreign youth development programme completed",
      data: { homeClubId: programme.homeClubId, programmeId: programme.id },
      importance: "low",
      scope: "person",
    });
    completed.push(finished);
  }
  return completed;
};

const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
