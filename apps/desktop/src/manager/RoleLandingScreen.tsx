import React from "react";
import type { CareerHeader, CareerRoleState } from "@nepal-football-sim/shared-types";
import { Metrics, Panel } from "./ui.js";

const roleCopy = {
  CHAIRMAN_OWNER: {
    title: "Chairman / Owner overview",
    subtitle: "Your controlling-owner context is active. Club finance, infrastructure, sponsorship, and manager appointments remain governed by the existing runtime services.",
  },
  FEDERATION_PRESIDENT: {
    title: "Federation President overview",
    subtitle: "Your federation leadership context is active. Governance proposals and national-team personnel remain governed by the existing runtime services.",
  },
} as const;

export const RoleLandingScreen = ({
  header,
  roles,
}: {
  header: CareerHeader;
  roles: CareerRoleState;
}): React.ReactElement => {
  const copy = roleCopy[header.activeRole as keyof typeof roleCopy];
  return (
    <section className="role-landing">
      <header className="page-header">
        <div>
          <p className="eyebrow">Held role</p>
          <h1>{copy?.title ?? "Career overview"}</h1>
          <p className="subtle">{copy?.subtitle ?? "This career role is active."}</p>
        </div>
      </header>
      <div className="summary-grid">
        <Panel title="Identity">
          <Metrics items={[
            { label: "Character", value: header.characterName },
            { label: "Active role", value: header.activeRole },
            { label: "World date", value: header.worldDate },
            { label: "Organisation", value: header.clubName ?? header.competitionName ?? "—" },
          ]} />
        </Panel>
        <Panel title="Held roles">
          <p className="subtle">Only roles held by this career are available in the selector.</p>
          <ul className="compact-list">
            {roles.heldRoles.map((role) => <li key={role}>{role === "CHAIRMAN_OWNER" ? "Chairman / Owner" : role === "FEDERATION_PRESIDENT" ? "Federation President" : "Manager"}</li>)}
          </ul>
        </Panel>
      </div>
      <Panel title="Role surface">
        <p className="empty-state">Dedicated {header.activeRole === "CHAIRMAN_OWNER" ? "owner" : "federation"} screens are not exposed yet. Use the role switcher to return to Manager mode; no unsupported actions are presented here.</p>
      </Panel>
    </section>
  );
};
