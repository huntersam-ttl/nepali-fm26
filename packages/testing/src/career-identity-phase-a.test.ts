import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CareerIdentityRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, getCareerIdentity, recordCareerMilestone, retireCareerRole, initializeClubEconomyForSave, runChairmanDemo } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";
describe("career identity phase A", () => { it("keeps one persistent identity across role milestones and retirement", () => {
  const dir=mkdtempSync(join(tmpdir(), "career-identity-a-")); const path=join(dir, "save.sqlite"); createNepalSave({databasePath:path,dataset:JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")),saveName:"career",gameVersion:"test",randomSeed:"career"}); const db=openGameDatabase(path); initializeClubEconomyForSave({db,worldDate:"2027-07-01",seed:"career"}); const club=db.prepare("SELECT id FROM clubs WHERE name='New Road Team'").get() as {id:EntityId}; const chairman=runChairmanDemo({db,seed:"career",worldDate:"2027-07-01",clubId:club.id}).chairmanPersonId; recordCareerMilestone(db,{personId:chairman,date:"2027-07-01",type:"OWNERSHIP",role:"CHAIRMAN_OWNER",title:"Acquired club",sourceEntityId:club.id,impact:{businessOwnership:8}}); recordCareerMilestone(db,{personId:chairman,date:"2030-06-01",type:"APPOINTMENT",role:"MANAGER",title:"Became manager",impact:{sporting:3}}); const identity=getCareerIdentity(db,chairman,"2030-06-01"); expect(identity.milestones).toHaveLength(2); expect(identity.reputation.businessOwnership).toBe(8); expect(identity.reputation.sporting).toBe(3); retireCareerRole(db,{personId:chairman,role:"MANAGER",date:"2031-01-01"}); expect(new CareerIdentityRepository(db).get(chairman)?.milestones).toHaveLength(2); db.close(); rmSync(dir,{recursive:true,force:true});
}); });
