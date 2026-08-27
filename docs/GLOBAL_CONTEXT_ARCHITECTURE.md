# Global Football Context Architecture

## Purpose

Nepal is the only fully playable country. External football makes Nepal feel connected through
persistent, deterministic context without running a second full management simulation.

## Full vs Context-Only

Nepal uses `FULL` simulation depth. External federations, leagues, clubs, seasons, and players use
`CONTEXT_ONLY`; they cannot become player-managed clubs.

## Entities

Migration 62 adds explicit external federation, league, club, league-season, player-context, and
foreign-scouting-interest records. Canonical clubs/persons remain shared with the core world.

## Seasonal Cadence

`processForeignFootballWorldSeason` updates one seeded league outcome per external league per season.
It stores champion, qualifiers, relegation, and bounded reputation movement without foreign fixtures
or detailed match events. Repeated calls are idempotent.

## Player Lifecycle

Foreign generated players are simulation-only and use the existing deterministic youth/replenishment
path. Their context records track club, region, reputation, availability, and career state.

## Scouting

External club scouting interest is persisted as bounded `MONITORING`/`INTERESTED` records based on
scouting reach and Nepal player visibility; hidden ability is never copied into the context record.

## Transfers

The existing transfer repository already operates on canonical external club/person IDs. The
context layer supplies external club metadata and interest signals; detailed foreign match play is
not required for a transfer.

## Partnerships

International partnerships reuse the existing network table and support bounded evaluation,
activation, and benefits for scouting, technical/youth development, loans, and commercial pathways.

## Continental Context

External leagues carry federation, reputation, tier, and continental-qualification metadata. AFC
is represented for current regional markets; broader confederation expansion remains data-driven.

## Data Provenance

Imported factual values retain their existing provenance. Generated context and generated players are
`SIMULATION_ONLY`.

## Excel Import Boundary

`football_world_import_v16.xlsx` should map stable source IDs (`PLY-*`, `CLB-*`, `STF-*`, and
competition/federation IDs) into these canonical records. Duplicate candidates must reconcile on
source ID plus identity evidence; names alone are not keys. Nepal verified data remains authoritative.

## Non-Playable Enforcement

Starting-club selection remains dataset-backed Nepal-only. Job application/acceptance, chairman, and
ownership paths reject clubs marked as external context-only.

## Performance Rules

External processing is seasonal and indexed. It does not invoke the detailed Nepal match engine for
ordinary foreign matches or generate ordinary foreign match-event histories.

## Future Data Import

Add real external leagues/clubs/players through the importer boundary without making those clubs
playable or weakening the context-only checks.
