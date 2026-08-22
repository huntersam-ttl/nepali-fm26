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

## Stage 3.1 Balance Pass

The Stage 3 baseline had three visible issues:

- Equal teams produced more away wins than home wins because home advantage was added to `overall`, while match control and chance creation used attack, midfield, defense, and goalkeeping directly.
- Scoring was too conservative because shot creation, shot-on-target probability, and xG were all cautious at the same time.
- Match-only injuries were too frequent for a system that will later add training and fatigue injuries.

Changes made:

- Home advantage now modestly affects attack, midfield/control, defense, goalkeeping, and set pieces before the match loop uses those dimensions.
- Added environment modifiers for future tuning: match tempo, pitch quality, referee strictness, weather impact, altitude impact, heat impact, competition physicality, and home advantage.
- Increased baseline chance creation and shot-on-target probability so goals emerge from more event chances, not from a final-score multiplier.
- Dampened strength-gap sensitivity so strong teams still dominate but individual-match variance remains meaningful.
- Reduced match injury probability to leave room for future non-match injury systems.
- Extended the balance report with score distributions, common scorelines, tracked scorelines, shot/xG diagnostics, conversion, save rate, cards, and injuries.

Final Stage 3.1 1,000-match harness snapshot:

- Equal: home 37.4%, draw 27.3%, away 35.3%, 2.44 goals/match.
- Strong vs weak: strong home 82.0%, draw 12.3%, underdog away 5.7%, 2.98 goals/match.
- Slight edge: favored home 49.5%, draw 26.3%, underdog away 24.2%, 2.40 goals/match.

Equal-team score distribution:

- 0 goals: 8.3%
- 1 goal: 22.9%
- 2 goals: 26.1%
- 3 goals: 19.8%
- 4 goals: 12.0%
- 5+ goals: 10.9%

Equal-team diagnostics:

- Shots: home 6.47, away 6.36
- Shots on target: home 4.29, away 4.23
- xG: home 1.29, away 1.25
- Conversion: 19.0%
- Save rate: 71.38%
- Yellow cards: 2.0 per match
- Red cards: 0.10 per match
- Match injuries: 0.13 per match

Still deliberately untuned:

- Separate competition environments are not calibrated yet.
- Weather, altitude, heat, and pitch values are hooks only; no Nepal-specific assumptions have been inserted.
- Strong-team dominance may still be a little high and should be revisited after squads, tactics, fatigue, substitutions, and more realistic player pools exist.
