# Player Development Balancing

The Stage 2 training model is intentionally transparent and conservative. It uses the 1-20 attribute
groups directly and avoids a hidden overall-rating shortcut.

## Inputs

- Age phase from a configurable development curve.
- Current attribute average and internal potential gap.
- Weekly training sessions, intensity, recovery, and rest.
- Individual focus for attributes, position, role, physical, technical, mental, or balanced growth.
- Coaching, facility, morale, and competition multipliers.
- Fitness, fatigue, recovery, match sharpness, and playing-time snapshots.
- Seeded variation through `SeededRandom`.

## Caps

Weekly attribute movement is capped, and position/role familiarity increments gradually. A player can
be selected out of position while still having poor familiarity; training does not make a new
position natural immediately.

## Regression

Late-prime and decline phases apply physical regression pressure. Development can still be helped by
training quality and professionalism, but older players should not grow like youth prospects.

## Injuries

Training produces `trainingInjuryRiskSignal` from load, fatigue, recovery, and fitness. It does not
create injury records directly; a future injury system should consume the signal.

## Diagnostic

Run:

```sh
pnpm development:simulate
```

The command simulates testing-only young, prime, and older players across 1, 3, and 5 seasons and
reports attribute movement, fitness, sharpness, position familiarity, load, fatigue, recovery, and
injury-risk signal.
