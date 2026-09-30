# Nepali Football Manager

A football management simulation built around Nepal and the wider Asian football ecosystem.

The project explores what a deeper football-management game could look like when leagues, clubs, players, academies, infrastructure, federation systems, and long-term development outside the biggest European leagues are treated as first-class parts of the simulation.

## Why this exists

Most football-management games naturally focus their greatest depth on established football markets.

I wanted to explore the opposite direction:

> What happens if Nepal is the starting point, and the game treats the development of an entire football ecosystem as seriously as managing an individual club?

That means the project is not only about transfers and match results. It is also about how clubs, players, youth systems, finances, infrastructure, scouting, national teams, and football institutions evolve over many seasons.

## Simulation areas

The repository currently includes simulation work around:

- careers
- seasons and multi-year progression
- player development
- youth systems
- scouting
- transfers
- club economy
- federation systems
- international football
- match simulation
- tactical balancing
- player balancing
- Nepal save generation

## Development commands

This is a pnpm monorepo.

```bash
pnpm install
pnpm dev
```

Build everything:

```bash
pnpm build
```

Run the test suite:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm e2e
```

The repository also exposes simulation-specific commands, including:

```bash
pnpm career:simulate
pnpm season:simulate
pnpm years:simulate
pnpm match:simulate
pnpm development:simulate
pnpm economy:simulate
pnpm federation:simulate
pnpm international:simulate
pnpm scouting:simulate
pnpm transfers:simulate
pnpm youth:simulate
pnpm players:balance
pnpm match:balance
pnpm tactics:balance
pnpm nepal:create-save
```

## Tech

- TypeScript
- React
- Vite
- pnpm workspaces
- Vitest
- Playwright
- ESLint
- Prettier

## Design direction

The goal is a management game with deep systems rather than a graphics-first football game.

Areas I want to keep pushing include:

- club identity and progression
- academy development
- training and performance systems
- medical and recovery systems
- facilities and infrastructure
- domestic competition depth
- national-team development
- wider Asian football integration
- richer long-term simulation
- stronger decision-making consequences

## Current status

Active development.

The simulation is being built iteratively: add a system, simulate it, inspect the outcomes, balance it, test it, and then connect it more deeply to the rest of the football world.

## Philosophy

```text
Build the system
      ↓
Simulate it
      ↓
Inspect what breaks
      ↓
Balance it
      ↓
Test again
      ↓
Add more depth
```

The ambition is simple:

**Make managing football in Nepal feel like managing a living football world, not a small database attached to a bigger game.**

---

Built by [Samir Kaliraj](https://github.com/huntersam-ttl)
