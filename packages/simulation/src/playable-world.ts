/**
 * The playable world boundary.
 *
 * The canonical global dataset adds hundreds of CONTEXT_ONLY clubs as backdrop for
 * transfers and reputation. Detailed domestic systems — workforce supply, youth
 * intake — must size themselves against the clubs the player actually manages, not
 * that backdrop. Country is the test, because context registration alone leaks:
 * some imported clubs never receive an `external_club_context` row.
 *
 * The SQL fragments below assume the clubs table is aliased as `c`.
 */
export const PLAYABLE_CLUB_PREDICATE = `EXISTS (
      SELECT 1 FROM countries co WHERE co.id = c.country_id AND co.iso_code IN ('NP', 'NPL')
    )
     AND NOT EXISTS (SELECT 1 FROM external_club_context ecc WHERE ecc.club_id = c.id)
     AND (c.canonical_external_id IS NULL OR c.canonical_external_id NOT LIKE 'SIM-FOREIGN-%')`;
