// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";
import type { EntityId, EntityReference, StructuredPressConferenceView } from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;

/**
 * Accessibility coverage for the structured press conference panel — the
 * question-by-question flow, journalist/outlet/entity links, response
 * options, and the completed-history state. Two bridge commands are mocked
 * with a real-shaped StructuredPressConferenceView (never raw JSON), so the
 * render is deterministic.
 */

const journalist: EntityReference = {
  entityType: "JOURNALIST",
  id: eid("journalist-1"),
  label: "Mina Rai",
  destination: "journalist",
  visible: true,
  allowedActions: ["OPEN_PROFILE"],
  provenanceStatus: "SIMULATION_ONLY",
};

const outlet: EntityReference = {
  entityType: "MEDIA_OUTLET",
  id: eid("outlet-1"),
  label: "Nepal Football News",
  destination: "media-outlet",
  visible: true,
  allowedActions: ["OPEN_PROFILE"],
  provenanceStatus: "SIMULATION_ONLY",
};

const playerRef: EntityReference = {
  entityType: "PLAYER",
  id: eid("player-1"),
  label: "Aayush Shrestha",
  destination: "player",
  visible: true,
  allowedActions: ["OPEN_PROFILE"],
  provenanceStatus: "SIMULATION_ONLY",
};

const openView: StructuredPressConferenceView = {
  interviewId: eid("interview-1"),
  context: "TRANSFER",
  status: "OPEN",
  journalist,
  outlet,
  totalQuestions: 2,
  currentQuestionIndex: 0,
  currentQuestion: {
    prompt: "Aayush Shrestha has been linked with a move away — will he stay?",
    subjectEntities: [playerRef],
    options: [
      { stance: "DEFLECT", text: "I'm not going to discuss speculation about one of our players." },
      { stance: "COMMIT", text: "He's going nowhere — he's part of our plans." },
    ],
  },
  priorAnswers: [],
  createdOn: "2026-09-05",
};

const answeredView: StructuredPressConferenceView = {
  ...openView,
  currentQuestionIndex: 1,
  priorAnswers: [
    {
      prompt: openView.currentQuestion!.prompt,
      responseText: "He's going nowhere — he's part of our plans.",
      consequenceSummary: "Aayush Shrestha's relationship with the manager improved slightly.",
    },
  ],
  currentQuestion: {
    prompt: "Do you expect any more transfer activity before the window closes?",
    subjectEntities: [],
    options: [{ stance: "NON_COMMITTAL", text: "We're always looking, but nothing imminent." }],
  },
};

const completedView: StructuredPressConferenceView = {
  ...answeredView,
  status: "COMPLETED",
  currentQuestion: undefined,
  completedSummary: "Transfer press conference opened. Completed after 2 questions.",
};

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const ownerOpenView: StructuredPressConferenceView = {
  ...openView,
  context: "OWNER_BUSINESS",
  currentQuestion: {
    prompt: "Investment has been approved for a new stand — what does this mean for the club's long-term ambitions?",
    subjectEntities: [],
    options: [
      { stance: "ASSERTIVE", text: "This is exactly the kind of investment that shows real ambition." },
      { stance: "CALM", text: "It's one step in a longer-term plan for the club." },
    ],
  },
};

const presidentOpenView: StructuredPressConferenceView = {
  ...openView,
  context: "FEDERATION_GOVERNANCE",
  currentQuestion: {
    prompt: "Why is the National Training Centre a priority for the federation right now?",
    subjectEntities: [],
    options: [
      { stance: "ASSERTIVE", text: "This is exactly the kind of investment that shows real ambition." },
      { stance: "CALM", text: "It's one step in a longer-term plan." },
    ],
  },
};

const sdOpenView: StructuredPressConferenceView = {
  ...openView,
  context: "RECRUITMENT",
  currentQuestion: {
    prompt: "What convinced you Aayush Shrestha was the right player to bring in?",
    subjectEntities: [playerRef],
    options: [
      { stance: "ASSERTIVE", text: "He was exactly the profile we identified and went out to get." },
      { stance: "PRAISE", text: "Everything about his character and ability fit what we needed." },
    ],
  },
};

const requestStructuredPressConference = vi.fn(() => ok(openView));
const answerStructuredPressQuestion = vi.fn(() => ok(answeredView));
const getStructuredPressConference = vi.fn(() => ok(completedView));
const getOwnerStructuredPressConference = vi.fn(() => ok(ownerOpenView));
const answerOwnerStructuredPressQuestion = vi.fn(() => ok(answeredView));
const getPresidentStructuredPressConference = vi.fn(() => ok(presidentOpenView));
const answerPresidentStructuredPressQuestion = vi.fn(() => ok(answeredView));
const getSportingDirectorStructuredPressConference = vi.fn(() => ok(sdOpenView));
const answerSportingDirectorStructuredPressQuestion = vi.fn(() => ok(answeredView));
const getOrganizationProfile = vi.fn(() =>
  ok({
    entityReference: journalist,
    organizationContext: "HOME_COUNTRY" as const,
    provenanceStatus: "SIMULATION_ONLY" as const,
    relationshipClues: ["Beat: player development", "Style: friendly", "Relationship: Positive"],
    activeDeals: [],
    dealHistory: [],
    currentNegotiations: [],
    involvedEntities: [outlet],
  }),
);

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    requestStructuredPressConference,
    answerStructuredPressQuestion,
    getStructuredPressConference,
    getOwnerStructuredPressConference,
    answerOwnerStructuredPressQuestion,
    getPresidentStructuredPressConference,
    answerPresidentStructuredPressQuestion,
    getSportingDirectorStructuredPressConference,
    answerSportingDirectorStructuredPressQuestion,
    getOrganizationProfile,
    getClubProfile: vi.fn(() => ok(undefined)),
  },
}));

let StructuredPressConferencePanel: typeof import("./MediaScreen.js").StructuredPressConferencePanel;
beforeEach(async () => {
  vi.clearAllMocks();
  requestStructuredPressConference.mockImplementation(() => ok(openView));
  answerStructuredPressQuestion.mockImplementation(() => ok(answeredView));
  getStructuredPressConference.mockImplementation(() => ok(completedView));
  getOwnerStructuredPressConference.mockImplementation(() => ok(ownerOpenView));
  answerOwnerStructuredPressQuestion.mockImplementation(() => ok(answeredView));
  getPresidentStructuredPressConference.mockImplementation(() => ok(presidentOpenView));
  answerPresidentStructuredPressQuestion.mockImplementation(() => ok(answeredView));
  getSportingDirectorStructuredPressConference.mockImplementation(() => ok(sdOpenView));
  answerSportingDirectorStructuredPressQuestion.mockImplementation(() => ok(answeredView));
  ({ StructuredPressConferencePanel } = await import("./MediaScreen.js"));
});
afterEach(() => cleanup());

describe("StructuredPressConferencePanel — accessibility", () => {
  it("exposes the panel title, journalist, and outlet as real named controls", async () => {
    render(<StructuredPressConferencePanel trigger={{ context: "TRANSFER" }} onClose={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: /transfer interview/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mina Rai" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nepal Football News" })).toBeTruthy();
  });

  it("renders the current question as a heading with real progress text and named response buttons", async () => {
    render(<StructuredPressConferencePanel trigger={{ context: "TRANSFER" }} onClose={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: openView.currentQuestion!.prompt })).toBeTruthy();
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    for (const option of openView.currentQuestion!.options) {
      expect(screen.getByRole("button", { name: option.text })).toBeTruthy();
    }
  });

  it("routes the subject player through onSelectPlayer as a real named control when the caller provides it", async () => {
    const onSelectPlayer = vi.fn();
    render(
      <StructuredPressConferencePanel
        trigger={{ context: "TRANSFER" }}
        onClose={vi.fn()}
        onSelectPlayer={onSelectPlayer}
      />,
    );
    const playerButton = await screen.findByRole("button", { name: "Aayush Shrestha" });
    fireEvent.click(playerButton);
    expect(onSelectPlayer).toHaveBeenCalledWith(playerRef.id);
  });

  it("still shows the subject player's real name (never a raw id) when no onSelectPlayer is available", async () => {
    render(<StructuredPressConferencePanel trigger={{ context: "TRANSFER" }} onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: openView.currentQuestion!.prompt });
    expect(screen.getByText("Aayush Shrestha")).toBeTruthy();
  });

  it("shows a football-natural consequence line after answering, never a stance enum", async () => {
    render(<StructuredPressConferencePanel trigger={{ context: "TRANSFER" }} onClose={vi.fn()} />);
    const commitButton = await screen.findByRole("button", { name: "He's going nowhere — he's part of our plans." });
    fireEvent.click(commitButton);
    expect(await screen.findByText(/relationship with the manager improved slightly/i)).toBeTruthy();
    expect(screen.queryByText(/COMMIT/)).toBeFalsy();
    expect(screen.queryByText(/DEFLECT/)).toBeFalsy();
  });

  it("shows the completed summary and no response controls once COMPLETED", async () => {
    render(<StructuredPressConferencePanel interviewId={eid("interview-1")} onClose={vi.fn()} />);
    expect(await screen.findByText(completedView.completedSummary!)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /he's going nowhere/i })).toBeFalsy();
  });

  it("has a real, named Close control", async () => {
    render(<StructuredPressConferencePanel trigger={{ context: "TRANSFER" }} onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: /transfer interview/i });
    expect(screen.getByRole("button", { name: /close/i })).toBeTruthy();
  });

  it("renders no clickable div/span in place of a real control", async () => {
    const { container } = render(
      <StructuredPressConferencePanel trigger={{ context: "TRANSFER" }} onClose={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: openView.currentQuestion!.prompt });
    expect(container.querySelectorAll("span[onclick], div[onclick]").length).toBe(0);
    for (const el of container.querySelectorAll("[role=button], [role=link]")) {
      expect(["BUTTON", "A"]).toContain(el.tagName);
    }
  });

  it("every button has an accessible name", async () => {
    const { container } = render(
      <StructuredPressConferencePanel trigger={{ context: "TRANSFER" }} onClose={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: openView.currentQuestion!.prompt });
    for (const button of container.querySelectorAll("button")) {
      expect(((button.textContent || button.getAttribute("aria-label")) ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("has no serious or critical axe violations", async () => {
    const { container } = render(
      <StructuredPressConferencePanel trigger={{ context: "TRANSFER" }} onClose={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: openView.currentQuestion!.prompt });
    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        "page-has-heading-one": { enabled: false },
        "landmark-one-main": { enabled: false },
      },
    });
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id} (${v.impact})`),
    ).toEqual([]);
  });

  it("owner context: resolves via the Owner bridge commands, titled as an Owner interview, with no serious or critical axe violations", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <StructuredPressConferencePanel interviewId={eid("interview-1")} ownerContext onClose={onClose} />,
    );
    expect(await screen.findByRole("heading", { name: /owner interview/i })).toBeTruthy();
    expect(getOwnerStructuredPressConference).toHaveBeenCalledWith(eid("interview-1"));
    expect(getStructuredPressConference).not.toHaveBeenCalled();

    const stanceButton = await screen.findByRole("button", {
      name: "This is exactly the kind of investment that shows real ambition.",
    });
    fireEvent.click(stanceButton);
    expect(await screen.findByText(/relationship with the manager improved slightly/i)).toBeTruthy();
    expect(answerOwnerStructuredPressQuestion).toHaveBeenCalledWith({
      interviewId: ownerOpenView.interviewId,
      stance: "ASSERTIVE",
    });
    expect(answerStructuredPressQuestion).not.toHaveBeenCalled();

    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        "page-has-heading-one": { enabled: false },
        "landmark-one-main": { enabled: false },
      },
    });
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id} (${v.impact})`),
    ).toEqual([]);
  });

  it("president context: resolves via the President bridge commands, titled as a Federation Press Conference, with no serious or critical axe violations", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <StructuredPressConferencePanel interviewId={eid("interview-1")} presidentContext onClose={onClose} />,
    );
    expect(await screen.findByRole("heading", { name: /federation press conference/i })).toBeTruthy();
    expect(getPresidentStructuredPressConference).toHaveBeenCalledWith(eid("interview-1"));
    expect(getStructuredPressConference).not.toHaveBeenCalled();
    expect(getOwnerStructuredPressConference).not.toHaveBeenCalled();

    const stanceButton = await screen.findByRole("button", {
      name: "This is exactly the kind of investment that shows real ambition.",
    });
    fireEvent.click(stanceButton);
    expect(await screen.findByText(/relationship with the manager improved slightly/i)).toBeTruthy();
    expect(answerPresidentStructuredPressQuestion).toHaveBeenCalledWith({
      interviewId: presidentOpenView.interviewId,
      stance: "ASSERTIVE",
    });
    expect(answerStructuredPressQuestion).not.toHaveBeenCalled();
    expect(answerOwnerStructuredPressQuestion).not.toHaveBeenCalled();

    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        "page-has-heading-one": { enabled: false },
        "landmark-one-main": { enabled: false },
      },
    });
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id} (${v.impact})`),
    ).toEqual([]);
  });

  it("sporting director context: resolves via the SD bridge commands, titled as a Recruitment Interview, with a named player link and no serious or critical axe violations", async () => {
    const onSelectPlayer = vi.fn();
    const { container } = render(
      <StructuredPressConferencePanel
        interviewId={eid("interview-1")}
        sportingDirectorContext
        onClose={vi.fn()}
        onSelectPlayer={onSelectPlayer}
      />,
    );
    expect(await screen.findByRole("heading", { name: /recruitment interview/i })).toBeTruthy();
    expect(getSportingDirectorStructuredPressConference).toHaveBeenCalledWith(eid("interview-1"));
    expect(getStructuredPressConference).not.toHaveBeenCalled();
    expect(getOwnerStructuredPressConference).not.toHaveBeenCalled();
    expect(getPresidentStructuredPressConference).not.toHaveBeenCalled();

    const playerButton = await screen.findByRole("button", { name: "Aayush Shrestha" });
    fireEvent.click(playerButton);
    expect(onSelectPlayer).toHaveBeenCalledWith(playerRef.id);

    const stanceButton = await screen.findByRole("button", {
      name: "He was exactly the profile we identified and went out to get.",
    });
    fireEvent.click(stanceButton);
    expect(await screen.findByText(/relationship with the manager improved slightly/i)).toBeTruthy();
    expect(answerSportingDirectorStructuredPressQuestion).toHaveBeenCalledWith({
      interviewId: sdOpenView.interviewId,
      stance: "ASSERTIVE",
    });
    expect(answerStructuredPressQuestion).not.toHaveBeenCalled();
    expect(answerOwnerStructuredPressQuestion).not.toHaveBeenCalled();
    expect(answerPresidentStructuredPressQuestion).not.toHaveBeenCalled();

    const results = await axe.run(container, {
      rules: {
        region: { enabled: false },
        "page-has-heading-one": { enabled: false },
        "landmark-one-main": { enabled: false },
      },
    });
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id} (${v.impact})`),
    ).toEqual([]);
  });
});
