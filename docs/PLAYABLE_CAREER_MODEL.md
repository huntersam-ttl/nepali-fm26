# Playable Career Model

## Product rule

The player has one persistent base football career and may temporarily hold an elected federation office.

### Playable base careers

- **Manager** (`MANAGER`)
- **Chairman / Owner** (`CHAIRMAN_OWNER`)

Chairman and Owner are one playable club-leadership career family. The UI may present the title as Owner, Chairman, or Chairman & Owner according to the actual ownership/control state.

### Temporary elected office

- **Federation President** (`FEDERATION_PRESIDENT`)

Federation President is not an independent permanent career. A successful election temporarily places the player in presidential authority while preserving the underlying Manager or Chairman/Owner career. When the presidency ends through defeat, term expiry, resignation, or removal, control returns to the preserved base career when it is still held.

### Non-player operational roles

Sporting Director, Director of Football, CEO, General Secretary, Technical Director and other staff/executive jobs remain part of the simulated football world. They are AI/NPC appointments and authority holders rather than selectable player career modes.

## Match presentation boundary

The playable match experience remains:

- Quick Sim
- Key Events
- Text Live

There is no 2D or 3D rendered match view. 3D presentation is reserved for the world around football: stadiums, facilities, club environments, boardrooms, federation spaces, transfers, press and other non-match presentation.

## Real-world data rule

Use real evidence when available. Where evidence is incomplete, keep the world playable with conservative, stable estimates or simulation-generated values using the existing provenance hierarchy:

- `VERIFIED`
- `REPORTED`
- `ESTIMATED`
- `UNKNOWN`
- `SIMULATION_ONLY`

Estimated or simulation-only data must never be presented internally as verified fact. Values and generated identities should be constrained by the football context: country, league level, club reputation, finances, geography, locality and infrastructure strength.

## Platform direction

PC is the primary development target. Mobile should later reuse the same simulation rules, save concepts and canonical world state with a touch-first presentation layer rather than becoming a separate simplified simulation.
