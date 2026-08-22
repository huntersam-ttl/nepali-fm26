# Match Engine Balancing Notes

Stage 3 uses an internal model for game simulation only. It is not a real-world provider xG model and should not be described as one.

## Strength Formula

Team strength is split into:

- attack
- midfield/control
- defense
- goalkeeping
- set pieces
- cohesion

The overall value is a weighted blend:

`attack * 0.27 + midfield * 0.24 + defense * 0.22 + goalkeeping * 0.17 + setPieces * 0.05 + cohesion * 0.05 + homeAdvantage`

Home advantage is currently a small additive placeholder. Manager quality and tactical cohesion are placeholders in the formula but are not gameplay systems yet.

## Chance Generation

The match engine simulates each minute. Midfield/control and attack influence which team attacks. Attack versus defense influences whether an attacking sequence becomes a shot.

Shot xG considers:

- chance type abstraction
- finisher finishing/composure
- assister passing/vision when present
- attacking strength
- defensive pressure
- goalkeeper strength

Goals are then sampled from shot xG adjusted by finisher composure and goalkeeper strength. Cards, fouls, and injuries are event probabilities, not post-match backfills.

## Balance Harness

Run:

`pnpm match:balance`

The harness simulates equal teams, strong versus weak teams, and slightly stronger versus weaker teams. It reports win/draw/loss rates, goals, xG, cards, and injuries for observation, not hard pass/fail tuning.
