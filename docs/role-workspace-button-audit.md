# Role workspace button audit

| Screen | Button / control | Command or route | PASS |
| --- | --- | --- | --- |
| Manager Home | Continue | `continueCareer` | PASS |
| Manager Home | Open fixtures / Open squad / Staff / Contracts / Competition | real manager screen routes | PASS |
| Manager Home | Consult captain / Hold squad meeting / concern actions | squad dynamics commands | PASS |
| Manager Tactics | Formation, style, lineup controls | `updateTactics` | PASS |
| Manager Staff | Hire, renew, licence, dismiss, responsibilities | staff market commands | PASS |
| Manager Player | Offer Contract | `renewContract` | PASS |
| Manager Fixtures | Matchday row, Quick Sim, Return to career | fixture and matchday commands | PASS |
| Chairman | Save budget | `setClubBudget` | PASS |
| Chairman | Appoint manager / approve facility project | `appointManager` / `createInfrastructureProject` | PASS |
| Chairman | Finance, Manager, Facilities, Sponsorship, Supporters | owner-office routes | PASS |
| President | Implement approved proposal | `implementFederationGovernanceProposal` | PASS |
| President | Governance, Finance, National Teams, Election / Tenure | federation-office routes | PASS |
| Global | Save, Save As, Main Menu, role selector | save/role runtime commands | PASS |

Unsupported campaign, takeover, merchandising, and fake chart controls are not
rendered. Loading, success, and specific error states are handled by the shared
runtime panels and command banners.
