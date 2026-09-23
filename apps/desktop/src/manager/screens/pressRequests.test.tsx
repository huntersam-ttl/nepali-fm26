// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  EntityId,
  MediaCentreView,
  MediaDirectoryView,
  MediaInterview,
  MediaStory,
} from "@nepal-football-sim/shared-types";

const eid = (value: string): EntityId => value as unknown as EntityId;
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

const eligible: MediaStory = ({ id: eid("elig-1"), outletId: eid("o1"), eventType: "TRANSFER", sourceEntityId: eid("s1"), publishedOn: "2025-09-03", importance: 7, headline: "High-profile transfer nears completion", summary: "The move is close.", subjectIds: [], reputationEffect: 1, status: "PUBLISHED", provenanceStatus: "SIMULATION_ONLY" }) as unknown as MediaStory;

const pending: MediaCentreView["pendingInterview"] = ({
  interview: { id: eid("iv-1"), outletId: eid("o1"), journalistId: eid("j1"), sourceEntityId: eid("s1"), interviewDate: "2025-09-03", context: "EVENT", importance: 6, questions: ["What is your view?"], responses: [], summary: "", managerReputationEffect: 0, clubSupportEffect: 0, status: "OPEN", provenanceStatus: "SIMULATION_ONLY" },
  questions: [{ id: "Q1", prompt: "What is your view?", options: ["CALM", "AMBITIOUS", "PROTECTIVE", "CONCILIATORY"] }],
  status: "OPEN",
  framing: "NEUTRAL",
}) as unknown as MediaCentreView["pendingInterview"];

const completed: MediaInterview = ({ id: eid("iv-2"), outletId: eid("o1"), journalistId: eid("j1"), sourceEntityId: eid("s1"), interviewDate: "2025-08-20", context: "TRANSFER", importance: 5, questions: [], responses: [], summary: "Completed", managerReputationEffect: 0, clubSupportEffect: 0, status: "COMPLETED", provenanceStatus: "SIMULATION_ONLY" }) as unknown as MediaInterview;

const pressView: MediaCentreView = ({
  recentStories: [],
  feed: [],
  eligibleForInterview: [eligible],
  pendingInterview: pending,
  completedInterviews: [completed],
}) as unknown as MediaCentreView;

const emptyView: MediaCentreView = ({ recentStories: [], feed: [], eligibleForInterview: [], pendingInterview: undefined, completedInterviews: [] }) as unknown as MediaCentreView;

const directory: MediaDirectoryView = ({
  outlets: [{ reference: { id: eid("o1"), entityType: "MEDIA_OUTLET", label: "Yeti Sports", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never }, name: "Yeti Sports", scope: "NATIONAL", storyCount: 1 }],
  journalists: [{ reference: { id: eid("j1"), entityType: "JOURNALIST", label: "Mira Gurung", visible: true, allowedActions: [], provenanceStatus: "SIMULATION_ONLY", destination: "DESTINATION" as never }, name: "Mira Gurung", outletName: "Yeti Sports", beat: "TRANSFERS" }],
}) as unknown as MediaDirectoryView;

const requestF = vi.fn(() => ok({ idle: true }));
const answerF = vi.fn(() => ok({ idle: true }));

vi.mock("../managerBridge.js", () => ({
  managerBridge: {
    getMediaCentre: vi.fn(() => ok(pressView)),
    getMediaDirectory: vi.fn(() => ok(directory)),
    requestPressConference: requestF,
    answerPressConference: answerF,
  },
}));

let press: typeof import("./PressRequestsScreen.js");

beforeAll(async () => {
  press = await import("./PressRequestsScreen.js");
});

afterEach(() => {
  cleanup();
  requestF.mockClear();
  answerF.mockClear();
});

describe("Press Requests", () => {
  it("1/2. maps the canonical pending/eligible/completed request state", () => {
    expect(press.pendingInterview(pressView)?.status).toBe("OPEN");
    expect(press.pendingInterview(pressView)?.framing).toBe("NEUTRAL");
    expect(press.eligibleStories(pressView).map((s) => s.headline)).toEqual(["High-profile transfer nears completion"]);
    expect(press.completedInterviews(pressView).map((i) => i.context)).toEqual(["TRANSFER"]);
  });

  it("3. preserves canonical ordering (eligible order, completed order)", () => {
    expect(press.eligibleStories(pressView)[0]!.id).toBe(eid("elig-1"));
    expect(press.completedInterviews(pressView)[0]!.id).toBe(eid("iv-2"));
    expect(press.completedInterviews(emptyView)).toEqual([]);
  });

  it("4/5. resolves journalist/outlet canonical references from the directory", () => {
    expect(press.journalistRefFor(directory, eid("j1"))?.label).toBe("Mira Gurung");
    expect(press.outletRefFor(directory, eid("o1"))?.label).toBe("Yeti Sports");
    expect(press.journalistRefFor(undefined, eid("j1"))).toBeUndefined();
  });

  it("6. shows an honest empty open-request state", async () => {
    const bridge = (await import("../managerBridge.js")).managerBridge;
    (bridge.getMediaCentre as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(emptyView));
    render(<press.PressRequestsScreen onOpenEntity={() => {}} />);
    await screen.findByText(/no press request is currently open/i);
    (bridge.getMediaCentre as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(ok(pressView));
  });

  it("8. never invents a deadline", async () => {
    render(<press.PressRequestsScreen onOpenEntity={() => {}} />);
    await screen.findByText(/high-profile transfer nears completion/i);
    expect(document.body.textContent).not.toMatch(/deadline|expir/i);
  });

  it("9/10. surfaces the canonical question + exact response options", async () => {
    render(<press.PressRequestsScreen onOpenEntity={() => {}} />);
    await screen.findByText(/what is your view\?/i);
    expect(press.MEDIA_STANCES).toEqual(["CALM", "AMBITIOUS", "PROTECTIVE", "CONCILIATORY"]);
  });

  it("15. never pre-fills a fabricated quote — the response is the player's own", async () => {
    render(<press.PressRequestsScreen onOpenEntity={() => {}} />);
    await screen.findByText(/what is your view\?/i);
    const textarea = screen.getByRole("textbox", { name: /your public response/i });
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("17. never exposes internal journalist relationship values", () => {
    const ref = press.journalistRefFor(directory, eid("j1"))!;
    if ("trust" in ref || "temperament" in ref || "hostility" in ref) {
      throw new Error("internal relationship field leaked into a reference");
    }
  });

  it("19. submits the answer through the canonical command with the player's stance and text", async () => {
    render(<press.PressRequestsScreen onOpenEntity={() => {}} />);
    await screen.findByText(/what is your view\?/i);
    const textarea = screen.getByRole("textbox", { name: /your public response/i });
    fireEvent.change(textarea, { target: { value: "We were calm and confident." } });
    const give = screen.getByRole("button", { name: /give response/i });
    fireEvent.click(give);
    await vi.waitFor(() => {
      expect(answerF).toHaveBeenCalled();
    });
    const calls = (answerF as unknown as {
      mock: { calls: Array<Array<{ interviewId: EntityId; stance: string; response: string }>> };
    }).mock.calls;
    const call = calls[0]![0];
    expect(call.interviewId).toBe(eid("iv-1"));
    expect(call.stance).toBe("CALM");
    expect(call.response).toBe("We were calm and confident.");
  });

  it("19b. requests a press conference through the canonical command", async () => {
    render(<press.PressRequestsScreen onOpenEntity={() => {}} />);
    await screen.findByText(/high-profile transfer nears completion/i);
    const requestBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Request coverage"));
    expect(requestBtn).toBeTruthy();
    fireEvent.click(requestBtn!);
    await vi.waitFor(() => {
      expect(requestF).toHaveBeenCalledWith(eid("elig-1"));
    });
  });
});