# Data Model

## Geography and Governance

- `Country`: national container, starting with Nepal in future data.
- `Location`: province, district, city, municipality, neighbourhood, airport, stadium, or unknown
  place within a country. Locations may carry city-level coordinates, altitude, and a coarse climate
  profile with field-level provenance in the source dataset.
- `Venue`: stadium, football ground, training ground, academy ground, multi-sport stadium, national
  training centre, or unknown venue linked to a country and optionally to province, district, city,
  and local/neighbourhood locations.
- `Federation`: national football governing body linked to a country.
- `LocationTravelContext`: basic imported travel context between two locations, including optional
  road distance, estimated road travel time, air-travel availability, and nearest airport. It is a
  data hook, not a route network.

## Clubs and Teams

- `Club`: football club with country, optional location, founded year, and ownership type.
- Club records may also carry a canonical external ID, official name, short name, Nepali-script
  name, organisation type, and parent organisation text when supplied by researched datasets.
- `ClubAlias`: common, former, sponsor, short, or search names attached to one club so aliases do
  not create duplicate club entities.
- `ClubRelationship`: parent/child links for men's first teams, women's branches, youth branches,
  academies, institutional parents, and linked entities.
- `ClubMembership`: season-specific competition membership independent of club identity. A club may
  move divisions without changing its stable club ID.
- `ClubOwnershipType`: supports `PRIVATE`, `CORPORATE`, `COMMUNITY`, `MEMBER_OWNED`, `DEPARTMENTAL`, `MUNICIPALITY_BACKED`, `INSTITUTIONAL`, and `UNKNOWN`.
- `Team`: senior, reserve, academy, or age-level side linked to a club or federation.
- `TeamPersonAssignment`: links imported players, managers, or staff to a team without turning squad management into gameplay yet.
- `Academy`: national, regional, club, private, or academy/club hybrid entity linked to a country
  and optionally to a parent club, linked club, federation, and location.
- `AcademySimulationProfile`: simulation-only youth recruitment, coaching, facilities, regional
  reach, and talent-identification values for academies or fallback club youth pathways.
- `CountryDevelopmentProfile`: simulation-only national football development environment consumed
  by youth generation and future federation investment hooks.
- `VenueRelationship`: staged venue use/ownership relationships with `OWNER`, `OPERATOR`,
  `PRIMARY_TENANT`, `TENANT`, `TEMPORARY_USER`, `SHARED_USER`, `TRAINING_USER`,
  `ACADEMY_USER`, `NATIONAL_TEAM_USER`, or `UNKNOWN` relationship types. Relationships may link to a
  club, team, federation, or academy and can be dated or season-specific.

## People and Careers

- `Person`: common human identity for all football careers.
- `PersonRole`: role history for `PLAYER`, `MANAGER`, `STAFF`, `AGENT`, `CHAIRMAN`, and `FEDERATION_OFFICIAL`.
- `CareerCharacter`: player-created character metadata, including name support through `Person`, selected starting age, background, education, playing experience, coaching licences, business background, and starting reputation profile.
- `ManagerProfile`: manager attributes linked to `Person`, covering tactical, coaching, people, recruitment, and personality categories.
- `ManagerContract`: basic manager employment with club/team, job title, contract dates, salary, currency, and `ACTIVE`, `RESIGNED`, `SACKED`, or `EXPIRED` status.
- `CoachingLicence`: licence level, issuing body, issue/expiry dates, requirements, and modest reputation effect. Testing data uses generic licences until researched Nepal/AFC rules are available.
- `StaffAppointment`: factual football workforce appointment for club, team, federation, academy,
  national-team, or named parent-organisation roles. It uses the same `Person` identity as players
  and managers, supports current, former, interim, expired, and unknown employment status, and allows
  departmental service rank/title without modeling full government employment.
- `StaffVacancy`: organisation staffing slot with a required flag and nullable assigned person so
  clubs can have vacancies without fake named staff.
- `StaffLicence`: factual staff licence record for AFC, UEFA, or other issuer licences. It stores
  licence status/provenance separately from job title and does not infer qualification from role.
- `RefereeProfile`: referee-specific factual profile linked to `Person`, covering referee level,
  FIFA listing fields, primary officiating role, eligible competitions, and experience text without
  importing referee ratings.
- `StaffProfile`: future staff-market hook for preferred role, availability, work eligibility,
  country knowledge, club knowledge, salary expectation text, and reputation text. Stage 2 does not
  generate staff attributes.
- `StaffHistoryEvent`: factual staff movement history for appointments, departures, federation
  official changes, and referee promotions.
- `StaffSimulationProfile`: internal training-effect attributes for coaches and staff. These are
  game simulation values and must be marked `SIMULATION_ONLY`, not inferred from factual job titles.

## Competitions and Matches

- `Competition`: domestic, local, continental, or international competition.
- Competition records may carry a Nepal-specific category such as `PYRAMID_LEAGUE`,
  `FRANCHISE_LEAGUE`, `SPECIAL_NATIONAL_LEAGUE`, `QUALIFICATION_LEAGUE`, `CUP`,
  `WOMENS_LEAGUE`, or `YOUTH_COMPETITION`.
- `CompetitionSeason`: dated edition of a competition.
- `CompetitionRuleSet`: dataset-driven rules for type, points, tiebreakers, fixture structure, dates,
  slot counts, promotion/relegation enablement, and exceptional season flags.
- `CompetitionRelationship`: configurable movement edge between competitions for promotion,
  relegation, and qualification.
- `CompetitionMovement`: persisted season-closure movement record for clubs moving or qualifying
  between competition seasons.
- `Fixture`: scheduled match between teams.
- `Match`: result record for a played fixture.
- `MatchEvent`: future quick-sim, key-event, or text-live event record.
- `LeagueStanding`: reconstructable table row for a competition season.
- `PlayerSeasonStat` and `TeamSeasonStat`: season totals derived from match outputs.
- `CompetitionWinner`: persisted winner record for completed seasons.
- `CompetitionDevelopmentMultiplier`: configurable development context for competitions. It exists
  as data so Nepal-specific or continental coefficients are not invented in application logic.

## Contracts and Movement

- `Contract`: shared employment agreement for a person and employer entity.
- `PlayerContract` and `StaffContract`: typed contract specializations.
- `Transfer`: permanent movement between clubs.
- `Loan`: temporary movement between clubs.
- `PlayerContractRecord`: save-backed player contract terms with start/end dates, role, salary,
  bonuses, release clause, status, and provenance. Generated Nepal starting contracts use
  `SIMULATION_ONLY` provenance when real terms are unavailable.
- `TransferWindow`: country or competition window with rule flags for free agents, loans, youth
  registration, emergency goalkeepers, and domestic-only windows. Nepal starter dates are
  simulation-only until researched.
- `TransferOffer` and `NegotiationRound`: structured club-to-club and player/agent negotiation state.
  Offers carry fees, add-ons, sell-on percentage, agent/signing fees, status, and bounded asking
  ranges rather than hidden minimum prices.
- `AgentProfile` and `AgentClient`: person-linked agent representation with simulation-only
  negotiation traits and client relationships.
- `PlayerLoanRecord`: loan terms that keep the parent club contract separate from temporary squad
  assignment and registration.
- `CompetitionRegistration`: competition-season registration independent of permanent contracts,
  including `TEMPORARY_NSL` for future Nepal Super League participation architecture.
- `ClubFinancialProfile` and `ClubEmploymentProfile`: simulation-only transfer/wage budgets and
  employment models such as departmental, semi-pro, standard, and franchise-temporary.
- `TransferHistoryEvent`: persisted movement history for transfers, free-agent signings, loans,
  renewals, expiries, releases, and transfer requests.

## Money

- `FinanceAccount`: separate owner account for `PERSON`, `CLUB`, or `FEDERATION`.
- `FinancialTransaction`: account movement with date, amount, currency, category, optional description, and optional related entity.
- `ClubFinancialAccount`: club-only institutional account with cash, restricted cash, receivables,
  payables, debt, equity, current-season revenue/expenses/profit, financial health, and provenance
  status.
- `ClubLedgerEntry`: auditable club money movement. Balances are updated from posted credit/debit
  entries for matchday revenue, sponsorship, prize money, transfers, wages, facilities, travel, owner
  investment, debt, grants, fines, and other categories.
- `ClubBudget`: season spending envelope for wages, transfers, staff, academy, facilities, scouting,
  and marketing. Budgets are board limits, not cash balances.
- `ClubOwnershipStake`: ownership/board stake for people, organisations, government bodies,
  communities, or unknown holders. Ownership model controls buyability and prevents departmental or
  state-controlled clubs from behaving like private companies.
- `PersonalFinancialProfile`: separate person-level cash, investments, assets, liabilities, and net
  worth for chairman/owner play.
- `OwnerInvestmentTransaction`: explicit bridge from personal cash into club cash as equity,
  shareholder loan, donation, or capital injection.
- `ClubDebt`: bank/finance/shareholder/short-term debt with principal, outstanding principal,
  interest rate, maturity, repayment schedule, and status.
- `SponsorOrganisation` and `SponsorshipContract`: simulation-world sponsors and club deals. Generated
  sponsor names avoid unlicensed real trademarks and are marked `SIMULATION_ONLY`.
- `ClubSupporterProfile`: aggregate supporter segments, popularity, commercial reputation, sentiment,
  and standard ticket price.
- `ClubFacilityProfile`: simulation-only training, youth, medical, analytics, academy capacity, and
  monthly operating-cost hooks separate from researched venue facts.
- `InfrastructureProject`: project-based infrastructure with planning/construction/completion dates,
  capital/ongoing costs, location/venue links, financing mix, and status.
- `ClubAsset`, `ClubValuation`, `ClubBoardPolicy`, and `ClubFinancialStatement`: assets, simulation
  valuation, board priorities, and annual financial close history for chairman mode.

## Social, Promise, and History

- `Relationship`: typed relationship between two entity refs.
- `Promise`: commitment from one entity to another, with due date and status.
- `ScheduledEvent`: persisted future simulation event.
- `HistoricalEvent`: alternate football history record with involved entities, importance, and scope.

## Imports

Import records validate payloads with provenance. Provenance records source, verification date, confidence, and whether the data is verified, reported, estimated, unknown, or simulation-only.

Stage 2 Nepal datasets wrap uncertain fields as facts:

- `value`: present only when the source supports a value.
- `status`: one of `VERIFIED`, `REPORTED`, `ESTIMATED`, `UNKNOWN`, or `SIMULATION_ONLY`.
- `provenance`: optional field-level source metadata when it differs from the record source.

The SQLite save stores relational entities plus `entity_provenance` rows so imported facts remain auditable after reload.

The August 2026 Nepal club registry import preserves canonical IDs such as `NEP-NSL-*`,
`NEP-DIVA-*`, `NEP-DIVB-*`, `NEP-DIVC-*`, `NEP-WOM-*`, and `NEP-ACA-*` as external IDs while
continuing to use internal stable entity IDs for save records.

The August 2026 Nepal player import adds `PlayerFactualProfile` records for real workbook players.
These records preserve canonical workbook IDs, name variants, club links, broad or exact factual
position evidence, source summaries, confidence, record status, factual DOB/height/foot coverage, and
deterministic simulation-only gameplay fields. The source register from the workbook is stored as
dataset metadata so source coverage can be audited without becoming simulation logic.

## Football Simulation

- `PlayerAttributeSet`: our own 1-20 game ratings across technical, mental, physical, and goalkeeping groups. Imported real-player ratings are game assessments and must be `SIMULATION_ONLY`.
- `PlayerFactualProfile`: source-backed player identity and evidence wrapper for imported real
  players. It must not promote generated exact positions, DOBs, heights, feet, reputations, hidden
  traits, abilities, or potentials to factual status.
- `GeneratedPlayerOrigin`: durable marker for generated youth/newgen people. It stores
  `SIMULATION_ONLY` origin data, stable generation keys, origin type, academy/club/location links,
  youth status, archetype, and Nepal or future diaspora eligibility without creating factual claims.
- `YouthIntakeEvent`: annual/seasonal intake record with country, club/academy source, generated
  counts, average current ability, average potential, highest potential, and seed key.
- `YouthPlayerStatus`: current academy/youth/reserve/first-team-prospect state for generated youth
  without forcing every player into the senior squad.
- `YouthDevelopmentActivity`: abstract academy training, reserve activity, local competition, or
  trial exposure so development can progress without simulating a full youth league pyramid.
- `PlayerRetirementState`: active, considering, announced, or retired status that preserves the
  original `Person` and career history.
- `RetiredStaffTransition`: simulation-only bridge from a retired player to coach, assistant coach,
  scout, academy coach, manager, or director using the existing staff appointment model.
- `TrainingPlan`: weekly plan for a team, made of sessions such as recovery, physical, technical,
  tactical, set-piece, goalkeeping, video, bonding, match preparation, rest, or future expanded
  categories.
- `IndividualDevelopmentPlan`: player-specific focus for attribute, position, role, physical,
  technical, mental, or balanced development, with intensity and lifecycle status.
- `PlayerDevelopmentState`: persistent state for development phase, training load, fatigue, match
  sharpness, fitness, recovery, momentum, position familiarity, role familiarity, and last update
  dates.
- `PlayerPotential`: internal potential ceiling and development traits. This is not a factual
  scouting claim and must be `SIMULATION_ONLY`.
- `PlayerPlayingTimeSnapshot`: minutes and appearances used by development and sharpness systems.
- `TrainingFacilityProfile`: club or academy facility hooks for training, youth, and medical
  quality. Missing values should be `UNKNOWN`, not guessed.
- `TrainingHistoryEvent`: sparse development log for plan changes, individual focus, position
  training, familiarity changes, attribute movement, overtraining, and return to full training.
- `MatchEnvironment`: neutral match modifier input used by the event-based match engine.
  `buildMatchEnvironmentFromVenue` exposes venue and location signals such as altitude, surface,
  pitch-quality enum, and climate risks for future derivation without inventing Stage 2 gameplay
  modifier values.
- `PlayerMatchState`: match-local state for fitness, fatigue, discipline, injuries, minutes, position, rating, and core stats.
- `InjuryRecord`: simple injury type, date, expected recovery, and severity.
- `SuspensionRecord`: competition-scoped disciplinary state for red cards and future yellow accumulation.
- `FormationDefinition`: preset or custom tactical shape made of coordinate-based slots and zones.
- `PlayerRoleDefinition`: reusable role requirements with weighted attributes and preferred zones.
- `RoleFit`: 0-100 fit score split into position, attributes, familiarity, physical suitability, and preferred-foot placeholder.
- `TeamInstructions`: mentality plus possession, transition, and out-of-possession instructions. Implemented settings feed tactical modifiers now or have a documented integration path.
- `TacticalSetup`: saved manager tactic containing formation, style, instructions, familiarity, XI assignments, bench, and basic set-piece takers.
- `TacticalShapeAnalysis`: derived width, central density, defensive coverage, midfield control, attacking numbers, rest defense, and pressing structure.
- `InboxItem`: basic system-generated items for fixture, result, injury, suspension, and competition updates.
- `player_availability_states`: persisted post-match fitness/form/morale availability snapshot for quick-sim continuity.
