import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubEconomyRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { DesktopApplicationService, generateSponsorOffers, initializeClubEconomyForSave } from "@nepal-football-sim/simulation";

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("chairman sponsorship production command", () => {
  it("accepts a sponsorship only for the active controlling chairman and persists finance", () => {
    const dir = mkdtempSync(join(tmpdir(), "chairman-sponsorship-command-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({ savesDirectory: dir, worldDatasetPath: registryPath });
    const created = service.createCareer({
      saveName: "Chairman sponsorship",
      character: {
        fullName: "Maya Adhikari", preferredDisplayName: "Maya", dateOfBirth: "1993-05-12", startingAge: 33,
        languages: ["ne", "en"], footballBackground: "COMMUNITY_COACHING", education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER", coachingExperience: "YOUTH_COACH", businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const path = created.data.catalogEntry.filePath;
    service.closeCareer();
    const db = openGameDatabase(path);
    const save = db.prepare("SELECT player_character_id, world_date FROM saves LIMIT 1").get() as { player_character_id: EntityId; world_date: string };
    const person = db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId };
    const manager = db.prepare("SELECT t.club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE'").get(person.person_id) as { club_id: EntityId };
    initializeClubEconomyForSave({ db, worldDate: save.world_date, seed: "chairman-sponsorship" });
    db.prepare("INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("chairman-sponsorship-owner", manager.club_id, "PERSON", person.person_id, "Maya Adhikari", "MAJORITY_OWNER", 75, 75, save.world_date, "ACTIVE", "PARTIALLY_BUYABLE", "SIMULATION_ONLY");
    const offers = generateSponsorOffers(db, { clubId: manager.club_id, date: save.world_date, seed: "chairman-sponsorship", count: 2 });
    const offer = offers[0]!;
    const rejectedOffer = offers[1]!;
    const anotherClub = db.prepare("SELECT id FROM clubs WHERE id<>? ORDER BY id LIMIT 1").get(manager.club_id) as { id: EntityId };
    db.close();

    expect(service.loadCareerByPath(path).ok).toBe(true);
    const offeredAgain = openGameDatabase(path);
    offeredAgain.prepare("UPDATE sponsorship_contracts SET status='OFFERED' WHERE id=?").run(offer.id);
    offeredAgain.close();
    expect(service.acceptSponsorOffer(manager.club_id, offer.id)).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.rejectSponsorOffer(manager.club_id, rejectedOffer.id)).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true });
    expect(service.acceptSponsorOffer(anotherClub.id, offer.id)).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    expect(service.rejectSponsorOffer(anotherClub.id, rejectedOffer.id)).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    expect(service.acceptSponsorOffer(manager.club_id, offer.id)).toMatchObject({ ok: true, data: { status: "ACTIVE" } });
    expect(service.acceptSponsorOffer(manager.club_id, offer.id)).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    expect(service.rejectSponsorOffer(manager.club_id, rejectedOffer.id)).toMatchObject({ ok: true, data: { status: "REJECTED" } });
    expect(service.rejectSponsorOffer(manager.club_id, rejectedOffer.id)).toMatchObject({ ok: true, data: { status: "REJECTED" } });
    expect(service.saveCareer().ok).toBe(true);
    service.closeCareer();

    const reloaded = openGameDatabase(path);
    const sponsorship = new ClubEconomyRepository(reloaded).sponsorships(manager.club_id).find((item) => item.id === offer.id);
    expect(sponsorship?.status).toBe("ACTIVE");
    expect(new ClubEconomyRepository(reloaded).sponsorships(manager.club_id).find((item) => item.id === rejectedOffer.id)?.status).toBe("REJECTED");
    expect((reloaded.prepare("SELECT COUNT(*) AS count FROM club_ledger_entries WHERE related_entity_id=? AND category='SPONSORSHIP'").get(offer.id) as { count: number }).count).toBe(1);
    reloaded.close();
  }, 300_000);
});
