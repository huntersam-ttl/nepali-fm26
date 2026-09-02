import type { EntityId, NationalTeamCommercialSettlement } from "@nepal-football-sim/shared-types";
import type { GameDatabase } from "./connection.js";

const map = (row: any): NationalTeamCommercialSettlement => ({
  id: row.id,
  federationId: row.federation_id,
  programme: row.programme,
  commercialProperty: row.commercial_property,
  sourceOrganizationId: row.source_organization_id,
  rightsOfferId: row.rights_offer_id,
  amount: row.amount,
  settledOn: row.settled_on,
  federationLedgerEntryId: row.federation_ledger_entry_id,
  restrictionTag: row.restriction_tag,
  provenanceStatus: row.provenance_status,
});

export class NationalTeamCommercialRepository {
  constructor(private readonly db: GameDatabase) {}

  insert(value: NationalTeamCommercialSettlement): void {
    this.db
      .prepare(
        `INSERT INTO national_team_commercial_settlements (id,federation_id,programme,commercial_property,source_organization_id,rights_offer_id,amount,settled_on,federation_ledger_entry_id,restriction_tag,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(rights_offer_id) DO NOTHING`,
      )
      .run(
        value.id,
        value.federationId,
        value.programme,
        value.commercialProperty,
        value.sourceOrganizationId,
        value.rightsOfferId,
        value.amount,
        value.settledOn,
        value.federationLedgerEntryId,
        value.restrictionTag,
        value.provenanceStatus,
      );
  }

  byOffer(rightsOfferId: EntityId): NationalTeamCommercialSettlement | undefined {
    const row = this.db
      .prepare("SELECT * FROM national_team_commercial_settlements WHERE rights_offer_id=?")
      .get(rightsOfferId);
    return row ? map(row) : undefined;
  }

  byProgramme(
    federationId: EntityId,
    programme: NationalTeamCommercialSettlement["programme"],
  ): NationalTeamCommercialSettlement[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM national_team_commercial_settlements WHERE federation_id=? AND programme=? ORDER BY settled_on,id",
        )
        .all(federationId, programme) as any[]
    ).map(map);
  }

  all(federationId?: EntityId): NationalTeamCommercialSettlement[] {
    return (
      federationId
        ? this.db
            .prepare(
              "SELECT * FROM national_team_commercial_settlements WHERE federation_id=? ORDER BY settled_on,id",
            )
            .all(federationId)
        : (this.db
            .prepare(
              "SELECT * FROM national_team_commercial_settlements ORDER BY federation_id,settled_on,id",
            )
            .all() as any[])
    ).map(map);
  }
}
