# Role workspace inventory

This inventory is the closure map for the role-workspace pass. Every item is
backed by the desktop runtime contract or is explicitly omitted.

| Role | Surface | Classification | Evidence / control |
| --- | --- | --- | --- |
| Manager | Home / Inbox | PRODUCTION_WORKING | `getManagerDashboard`, concern actions, Continue |
| Manager | Squad / Player | PRODUCTION_WORKING | `getSquad`, `getPlayerProfile`, contract renewal |
| Manager | Tactics | PRODUCTION_WORKING | `getTactics`, `updateTactics` |
| Manager | Training / Medical | PRODUCTION_WORKING | existing read models and commands |
| Manager | Fixtures / Competition | PRODUCTION_WORKING | fixture and table read models; matchday commands |
| Manager | Scouting / Transfers / Contracts | PRODUCTION_WORKING | existing search, shortlist, offer, renewal commands |
| Manager | Staff | PRODUCTION_WORKING | staff market, hierarchy, hiring and responsibility commands |
| Chairman / Owner | Dashboard | PRODUCTION_WORKING | `getChairmanDashboard` |
| Chairman / Owner | Finance / Budget | COMMAND_WORKING | club ledger and `setClubBudget` |
| Chairman / Owner | Manager | COMMAND_WORKING | candidate list and `appointManager` |
| Chairman / Owner | Facilities | COMMAND_WORKING | infrastructure read model and project command |
| Chairman / Owner | Sponsorship / Supporters | READ_MODEL_ONLY | sponsorship and supporter data in dashboard |
| Chairman / Owner | Boardroom / Merchandising / Takeover | UNSUPPORTED | omitted |
| Federation President | Dashboard | PRODUCTION_WORKING | `getFederationPresidentDashboard` |
| Federation President | Governance | COMMAND_WORKING | proposal list and implementation command |
| Federation President | Finance | READ_MODEL_ONLY | federation-only accounts, budgets, ledger, statements |
| Federation President | National Teams | READ_MODEL_ONLY | national-team summaries and coach status |
| Federation President | Tenure / Candidacy | READ_MODEL_ONLY | tenure and existing candidacy service |
| Federation President | Campaign / political simulation | UNSUPPORTED | omitted |

Visible actions are limited to navigation, reads, or canonical commands. No
dead placeholder controls are part of the intended surface.
