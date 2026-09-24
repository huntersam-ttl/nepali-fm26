import React from "react";
import type {
  EntityReference,
  FederationCompetitionGovernance,
  FederationCompetitionRow,
  FederationDevelopmentProgrammes,
  FederationLicenceCaseView,
  FederationProgrammeView,
  FederationReformView,
} from "@nepal-football-sim/shared-types";
import type { DesktopRuntimeApi } from "../../appBridge.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import { humanizeToken } from "../storyHumanizer.js";
import { AsyncPanel, Badge, Panel, money, useRuntimeData } from "../ui.js";

/**
 * Phase 9C — competition governance and development programmes (President,
 * read-only).
 *
 * Competitions, reforms, club licence cases and programmes are shown exactly as
 * recorded. Nothing is scored or ranked, and the screen has no way to change a
 * competition: reforms are proposed and approved through Governance, and
 * applying an approved reform to a season is not available from this office.
 */

export type GovernanceTarget = "governance" | "finance" | "national-development" | "competition-pyramid";

type Tone = "ok" | "warn" | "bad" | "info";

export const reformStatusTone = (status: string): Tone =>
  status === "IMPLEMENTED" || status === "APPROVED" ? "ok" : status === "REJECTED" ? "bad" : "info";

export const licenceStatusTone = (status: string): Tone =>
  status === "PASSED" || status === "RESOLVED" ? "ok" : status === "FAILED" ? "bad" : status === "CONDITIONAL" ? "warn" : "info";

/** Only the fields a reform actually changes, in a stable order. */
export const reformChangeLines = (changes: FederationReformView["changes"]): string[] => {
  const lines: string[] = [];
  if (changes.teamCount !== undefined) lines.push(`Teams: ${changes.teamCount}`);
  if (changes.rounds !== undefined) lines.push(`Rounds: ${changes.rounds}`);
  if (changes.promotionSlots !== undefined) lines.push(`Promotion places: ${changes.promotionSlots}`);
  if (changes.relegationSlots !== undefined) lines.push(`Relegation places: ${changes.relegationSlots}`);
  if (changes.format !== undefined) lines.push(`Format: ${humanizeToken(changes.format)}`);
  if (changes.calendarStart !== undefined || changes.calendarEnd !== undefined)
    lines.push(`Calendar: ${changes.calendarStart ?? "unchanged"} – ${changes.calendarEnd ?? "unchanged"}`);
  return lines;
};

export const licenceCounts = (cases: Array<{ status: string }>): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const item of cases) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  return [...counts.entries()];
};

export const competitionCategoryLabel = (category?: string): string => (category ? humanizeToken(category) : "Not classified");

export const CompetitionGovernancePanels = ({
  bridge,
  onNavigate,
  onOpenReference,
}: {
  bridge: Pick<DesktopRuntimeApi, "getFederationCompetitionGovernance">;
  onNavigate: (target: GovernanceTarget) => void;
  onOpenReference: (reference: EntityReference) => void;
}): React.ReactElement | null => {
  const [state] = useRuntimeData(
    () =>
      bridge.getFederationCompetitionGovernance
        ? bridge.getFederationCompetitionGovernance()
        : Promise.resolve({
            ok: false as const,
            error: { code: "RUNTIME_UNAVAILABLE" as const, message: "Competition governance is unavailable right now." },
          }),
    [],
  );
  return (
    <AsyncPanel state={state}>
      {(view: FederationCompetitionGovernance) => (
        <>
          <Panel title="Domestic competitions" className="panel-wide">
            {view.competitions.length === 0 ? (
              <p className="empty-state">No domestic competitions are recorded for this federation.</p>
            ) : (
              <div className="table-scroll" role="region" aria-label="Domestic competitions" tabIndex={0}>
                <table>
                  <caption className="visually-hidden">Domestic competitions of the federation</caption>
                  <thead>
                    <tr>
                      <th scope="col">Competition</th>
                      <th scope="col">Category</th>
                      <th scope="col">Latest season</th>
                      <th scope="col">Status</th>
                      <th scope="col">Teams</th>
                      <th scope="col">Format</th>
                      <th scope="col">Promotion</th>
                      <th scope="col">Relegation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.competitions.map((row: FederationCompetitionRow) => (
                      <tr key={row.competition.id}>
                        <th scope="row">
                          <EntityRefLink reference={row.competition} onOpen={onOpenReference} />
                        </th>
                        <td>{competitionCategoryLabel(row.category)}</td>
                        <td>{row.seasonName ?? "No season on record"}</td>
                        <td>{row.seasonStatus ? <Badge tone="info">{row.seasonStatus}</Badge> : "—"}</td>
                        <td>{row.teamCount}</td>
                        <td>{row.format ? humanizeToken(row.format) : "—"}</td>
                        <td>{row.promotionSlots ?? "—"}</td>
                        <td>{row.relegationSlots ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="subtle">
              <Badge tone="info">simulated</Badge> Competition structure is generated by the simulation, not
              real-world records.
            </p>
          </Panel>

          <Panel title="Competition reforms" className="panel-wide">
            {view.reforms.length === 0 ? (
              <p className="empty-state">No competition reforms have been recorded.</p>
            ) : (
              <div className="table-scroll" role="region" aria-label="Competition reforms" tabIndex={0}>
                <table>
                  <caption className="visually-hidden">Recorded competition reforms</caption>
                  <thead>
                    <tr>
                      <th scope="col">Competition</th>
                      <th scope="col">Effective season</th>
                      <th scope="col">Changes</th>
                      <th scope="col">Status</th>
                      <th scope="col">Proposed</th>
                      <th scope="col">Decided</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.reforms.map((reform) => {
                      const lines = reformChangeLines(reform.changes);
                      return (
                        <tr key={reform.id}>
                          <th scope="row">
                            <EntityRefLink reference={reform.competition} onOpen={onOpenReference} />
                          </th>
                          <td>{reform.effectiveSeason}</td>
                          <td>{lines.length === 0 ? "No structural change recorded" : lines.join(" · ")}</td>
                          <td>
                            <Badge tone={reformStatusTone(reform.status)}>{humanizeToken(reform.status)}</Badge>
                          </td>
                          <td>{reform.proposedAt}</td>
                          <td>{reform.decidedAt ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="subtle">
              Reforms are proposed and approved through Governance. Applying an approved reform to a season is not
              available from this office.
            </p>
            <div className="button-row">
              <button className="ghost small" onClick={() => onNavigate("governance")}>
                Open Governance
              </button>
            </div>
          </Panel>

          <Panel
            title={view.licensing.seasonLabel ? `Club licensing · ${view.licensing.seasonLabel}` : "Club licensing"}
            className="panel-wide"
          >
            {view.licensing.cases.length === 0 ? (
              <p className="empty-state">No club licence cases are on record yet. They are opened when a season completes.</p>
            ) : (
              <>
                <p className="subtle">
                  {licenceCounts(view.licensing.cases)
                    .map(([status, count]) => `${humanizeToken(status)}: ${count}`)
                    .join(" · ")}
                </p>
                <div className="table-scroll" role="region" aria-label="Club licence cases" tabIndex={0}>
                  <table>
                    <caption className="visually-hidden">Club licence cases for the latest season</caption>
                    <thead>
                      <tr>
                        <th scope="col">Club</th>
                        <th scope="col">Licence</th>
                        <th scope="col">Open requirements</th>
                        <th scope="col">Consequences</th>
                        <th scope="col">Reviewed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.licensing.cases.map((item: FederationLicenceCaseView) => (
                        <tr key={item.id}>
                          <th scope="row">
                            <EntityRefLink reference={item.club} onOpen={onOpenReference} />
                          </th>
                          <td>
                            <Badge tone={licenceStatusTone(item.status)}>{humanizeToken(item.status)}</Badge>
                          </td>
                          <td>
                            {item.openRequirements.length === 0
                              ? "None"
                              : item.openRequirements.map((r) => `${r.requirement} (by ${r.deadline})`).join("; ")}
                          </td>
                          <td>{item.sanctions.length === 0 ? "None" : item.sanctions.map(humanizeToken).join(", ")}</td>
                          <td>{item.reviewedAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <p className="subtle">
              Licences are decided by the season-end check on each club&rsquo;s record and decide promotion
              eligibility. The federation does not grant or deny them by hand.
            </p>
          </Panel>

          <Panel title="Related" className="panel-wide">
            <ul className="report-list">
              <li>
                Youth, women&rsquo;s and referee development{" "}
                <button className="ghost small" onClick={() => onNavigate("national-development")}>
                  National Development
                </button>
              </li>
              <li>
                Competition and club-support budgets{" "}
                <button className="ghost small" onClick={() => onNavigate("finance")}>
                  Finance
                </button>
              </li>
            </ul>
          </Panel>
        </>
      )}
    </AsyncPanel>
  );
};

const BUDGET_LABEL: Record<string, string> = {
  YOUTH_DEVELOPMENT: "Youth development",
  GRASSROOTS: "Grassroots",
  WOMENS_FOOTBALL: "Women's football",
  COACH_EDUCATION: "Coach education",
  REFEREE_DEVELOPMENT: "Referee development",
};

const ProgrammeTable = ({
  caption,
  rows,
  labelHeader,
}: {
  caption: string;
  rows: FederationProgrammeView[];
  labelHeader: string;
}): React.ReactElement => (
  <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
    <table>
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{labelHeader}</th>
          <th scope="col">Dates</th>
          <th scope="col">Capacity</th>
          <th scope="col">Cost</th>
          <th scope="col">Result</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.kind === "REFEREE" ? humanizeToken(row.label) : row.label}</th>
            <td>
              {row.startDate} – {row.endDate}
            </td>
            <td>{row.capacity}</td>
            <td>{money(row.cost, row.currency)}</td>
            <td>
              {row.outcome} {row.outcomeLabel.toLowerCase()}
            </td>
            <td>
              <Badge tone={row.status === "COMPLETED" ? "ok" : "info"}>{humanizeToken(row.status)}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const DevelopmentProgrammesPanel = ({
  bridge,
  onNavigate,
}: {
  bridge: Pick<DesktopRuntimeApi, "getFederationDevelopmentProgrammes">;
  onNavigate: (target: "finance") => void;
}): React.ReactElement => {
  const [state] = useRuntimeData(
    () =>
      bridge.getFederationDevelopmentProgrammes
        ? bridge.getFederationDevelopmentProgrammes()
        : Promise.resolve({
            ok: false as const,
            error: { code: "RUNTIME_UNAVAILABLE" as const, message: "Development programmes are unavailable right now." },
          }),
    [],
  );
  return (
    <Panel title="Development programmes and funding" className="panel-wide">
      <AsyncPanel state={state}>
        {(view: FederationDevelopmentProgrammes) => (
          <>
            <h3>Coach education</h3>
            {view.coachEducation.length === 0 ? (
              <p className="empty-state">No coach-education programme has been run.</p>
            ) : (
              <ProgrammeTable caption="Coach-education programmes" rows={view.coachEducation} labelHeader="Licence level" />
            )}
            <h3>Referee development</h3>
            {view.referee.length === 0 ? (
              <p className="empty-state">No referee development programme has been run.</p>
            ) : (
              <ProgrammeTable caption="Referee development programmes" rows={view.referee} labelHeader="Programme" />
            )}
            <h3>Season funding</h3>
            {view.budgets.length === 0 ? (
              <p className="empty-state">No development budgets are on record.</p>
            ) : (
              <div className="table-scroll" role="region" aria-label="Development budgets" tabIndex={0}>
                <table>
                  <caption className="visually-hidden">Season budgets for development areas</caption>
                  <thead>
                    <tr>
                      <th scope="col">Area</th>
                      <th scope="col">Allocated</th>
                      <th scope="col">Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.budgets.map((budget) => (
                      <tr key={budget.category}>
                        <th scope="row">{BUDGET_LABEL[budget.category] ?? humanizeToken(budget.category)}</th>
                        <td>{money(budget.amount, budget.currency)}</td>
                        <td>{money(budget.usedAmount, budget.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="subtle">
              <Badge tone="info">simulated</Badge> Programmes are recorded by the simulation. Coach-education
              graduates are federation licences for coaches across the country, separate from your own career
              qualifications.
            </p>
            <div className="button-row">
              <button className="ghost small" onClick={() => onNavigate("finance")}>
                Open Finance
              </button>
            </div>
          </>
        )}
      </AsyncPanel>
    </Panel>
  );
};
