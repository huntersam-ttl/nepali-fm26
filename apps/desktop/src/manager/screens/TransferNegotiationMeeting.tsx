import React, { useState } from "react";
import type {
  AppResult,
  EntityId,
  PlayerMarketValueView,
  TransferCentre,
} from "@nepal-football-sim/shared-types";
import { managerBridge } from "../managerBridge.js";
import { AsyncPanel, Badge, ErrorBanner, Panel, money, useRuntimeData } from "../ui.js";
import type { AppError } from "../../appBridge.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import {
  MeetingBrief,
  MeetingOptions,
  MeetingOutcome,
  MeetingParticipants,
  MeetingShell,
  type MeetingContextItem,
  type MeetingOption,
} from "../meetings.js";
import {
  daysUntilResponse,
  negotiationHistoryEntries,
  negotiationNarrative,
  negotiationOptions,
  negotiationStage,
} from "../negotiationPresentation.js";
import { MeetingEnvironmentScene } from "../../presentation/MeetingEnvironmentScene.js";

/**
 * Real, bounded transfer/loan importance from the fee relative to the
 * club's own real remaining transfer budget — never a fabricated "record
 * signing" claim. A fee that would exhaust (or exceed) the remaining
 * budget is genuinely MAJOR for this club; a fee using up a large share of
 * it is IMPORTANT; anything else stays ROUTINE. A loan (no fee) is always
 * ROUTINE here — its stakes show up in wage contribution, not transfer
 * spend.
 */
export const transferNegotiationImportance = (
  transferFee: number,
  transferBudgetRemaining: number,
  isLoan: boolean,
): "ROUTINE" | "IMPORTANT" | "MAJOR" => {
  if (isLoan || transferFee <= 0) return "ROUTINE";
  if (transferBudgetRemaining <= 0 || transferFee >= transferBudgetRemaining) return "MAJOR";
  const share = transferFee / transferBudgetRemaining;
  if (share >= 0.5) return "IMPORTANT";
  return "ROUTINE";
};

/**
 * The dedicated negotiation meeting — a presentation/action surface over the
 * canonical TransferOffer/NegotiationRound state (via the same manager
 * bridge commands the Transfer Centre table uses), reusing the shared
 * Meeting framework (MeetingShell/MeetingParticipants/MeetingBrief/
 * MeetingOptions/MeetingOutcome). It does not create or read a
 * UniversalInteraction session — TRANSFER_NEGOTIATION's reserved interaction
 * type maps onto a stance-based demands/offers bag that doesn't fit the
 * fee/installments/loan-terms model this offer already persists, and
 * bridging the two would mean two synchronized copies of the same
 * negotiation — exactly the "second transfer engine" this sprint prohibits.
 */
export const TransferNegotiationMeeting = ({
  offerId,
  centre,
  onClose,
  onUpdate,
  onSelectPlayer,
  onOpenClub,
}: {
  offerId: EntityId;
  centre: TransferCentre;
  onClose: () => void;
  onUpdate: (centre: TransferCentre) => void;
  onSelectPlayer: (playerId: EntityId) => void;
  onOpenClub: (clubId: EntityId) => void;
}): React.ReactElement => {
  const offer = [...centre.incoming, ...centre.outgoing].find((row) => row.id === offerId);
  const playerId = offer?.playerId;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [counterWage, setCounterWage] = useState<string>("");

  const [marketValueState] = useRuntimeData(
    (): Promise<AppResult<PlayerMarketValueView>> =>
      playerId
        ? managerBridge.getPlayerMarketValue(playerId)
        : Promise.resolve({
            ok: false,
            error: { code: "INVALID_SELECTION", message: "No negotiation selected." },
          }),
    [playerId],
  );
  const [squadState] = useRuntimeData(() => managerBridge.getSquad(), []);

  if (!offer) {
    return (
      <Panel
        title="Negotiation"
        className="panel-wide negotiation-meeting-panel"
        actions={
          <button className="ghost small" onClick={onClose}>
            Close
          </button>
        }
      >
        <p className="empty-state">
          This negotiation is no longer available — it may have just been resolved.
        </p>
      </Panel>
    );
  }

  const isLoan = Boolean(offer.loanTerms);
  const isOurBid = offer.direction === "INCOMING";
  const isTerminal =
    offer.status === "COMPLETED" || offer.status === "REJECTED" || offer.status === "WITHDRAWN";
  const stage = negotiationStage(offer);
  const otherClubLabel = offer.otherClub?.label ?? offer.otherClubName ?? "Unknown club";

  const run = async (
    id: string,
    action: () => Promise<Awaited<ReturnType<typeof managerBridge.getTransferCentre>>>,
  ): Promise<void> => {
    if (busyId) return;
    setBusyId(id);
    const result = await action();
    setBusyId(null);
    if (result.ok) {
      onUpdate(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  const options: MeetingOption[] = negotiationOptions(offer);

  const onChoose = (id: string): void => {
    if (id === "withdraw" && isLoan) {
      void run(id, () => managerBridge.respondLoanOffer({ offerId: offer.id, action: "WITHDRAW" }));
      return;
    }
    if (id === "withdraw") {
      void run(id, () => managerBridge.withdrawTransferOffer({ offerId: offer.id }));
      return;
    }
    if (id === "accept-counter") {
      void run(id, () => managerBridge.respondLoanOffer({ offerId: offer.id, action: "ACCEPT" }));
      return;
    }
    if (id === "counter" && isLoan) {
      const parsed = Number(counterWage);
      void run(id, () =>
        managerBridge.counterLoanOffer({
          offerId: offer.id,
          wageContributionPercent: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
        }),
      );
      return;
    }
    if (id === "accept") {
      void run(id, () => managerBridge.respondTransferOffer({ offerId: offer.id, action: "ACCEPT" }));
      return;
    }
    if (id === "reject") {
      void run(id, () => managerBridge.respondTransferOffer({ offerId: offer.id, action: "REJECT" }));
      return;
    }
    if (id === "counter") {
      void run(id, () =>
        managerBridge.respondTransferOffer({
          offerId: offer.id,
          action: "COUNTER",
          transferFee: Math.round(offer.transferFee * 1.1),
        }),
      );
    }
  };

  const context: MeetingContextItem[] = [
    { label: "Transfer budget remaining", value: money(centre.budget.transferRemaining, centre.budget.currency) },
    { label: "Wage budget remaining", value: money(centre.budget.wageRemaining, centre.budget.currency) },
    { label: "Asking range", value: offer.askingRange ? `${money(offer.askingRange.min, offer.currency)}–${money(offer.askingRange.max, offer.currency)}` : "Unknown" },
  ];

  if (marketValueState.status === "ready") {
    const mv = marketValueState.data;
    context.push(
      { label: "Market value", value: `${money(mv.valuationMin, mv.currency)}–${money(mv.valuationMax, mv.currency)}` },
      { label: "Club stance", value: mv.clubStance },
      { label: "Interest", value: mv.interestSummary },
    );
    if (mv.contractLeverageMonths !== undefined) {
      context.push({ label: "Contract leverage", value: `${mv.contractLeverageMonths} months remaining` });
    }
  }

  if (offer.direction === "OUTGOING" && squadState.status === "ready") {
    const squadRow = squadState.data.players.find((player) => player.personId === offer.playerId);
    if (squadRow) context.push({ label: "Squad role", value: squadRow.squadStatus });
  }

  const historyEntries = negotiationHistoryEntries(offer);
  const narrative = negotiationNarrative(offer, centre.worldDate);
  const days = daysUntilResponse(centre.worldDate, offer.respondBy);

  return (
    <article className="panel panel-wide negotiation-meeting-panel">
      <header className="panel-head">
        <span />
        <button className="ghost small" onClick={onClose}>
          Close
        </button>
      </header>
      {error && <ErrorBanner error={error} />}
      <MeetingShell
        title={`${offer.playerName ?? "Unknown player"} — ${isLoan ? "Loan" : "Transfer"} negotiation`}
        meetingType={isLoan ? "LOAN NEGOTIATION" : "TRANSFER NEGOTIATION"}
        deadline={offer.respondBy}
        context={context}
      >
        <MeetingEnvironmentScene
          context="NEGOTIATION"
          // No club facility state is available to this manager-scoped
          // negotiation surface — MODEST is a conservative, honest default
          // rather than a guessed tier.
          environmentTier="MODEST"
          importance={transferNegotiationImportance(offer.transferFee, centre.budget.transferRemaining, isLoan)}
          organisationId={String(offer.id)}
          organisationName={otherClubLabel}
          fallback={null}
        />
        <section aria-label="Deal summary" className="negotiation-summary">
          <div className="negotiation-badges">
            <Badge tone="info">{isLoan ? "Loan" : offer.offerType === "FREE_TRANSFER" ? "Free transfer" : "Permanent"}</Badge>
            <Badge tone={stage.tone}>{stage.label}</Badge>
          </div>
          <button className="link negotiation-player-link" onClick={() => onSelectPlayer(offer.playerId)}>
            {offer.playerName ?? "Unknown player"}
          </button>
          <p className="subtle">
            {isOurBid ? "Your club" : (offer.otherClub ? <EntityRefLink reference={offer.otherClub} onOpen={(reference) => onOpenClub(reference.id)} /> : otherClubLabel)}
            {" → "}
            {isOurBid ? (offer.otherClub ? <EntityRefLink reference={offer.otherClub} onOpen={(reference) => onOpenClub(reference.id)} /> : otherClubLabel) : "Your club"}
          </p>
        </section>

        <MeetingParticipants
            initiator={{ name: "You", role: "Manager", organisation: "Your club" }}
            counterpart={{
              name: offer.agentContact === "AGENT" ? "Player's agent" : otherClubLabel,
              role: offer.agentContact === "AGENT" ? "Agent" : "Club representative",
              organisation: offer.agentContact === "AGENT" ? otherClubLabel : undefined,
            }}
          />

          <MeetingBrief heading="Current proposal">
            <p>
              Fee {money(offer.transferFee, offer.currency)}
              {offer.installments ? ` (${money(offer.installments, offer.currency)} in instalments)` : ""}
              {offer.sellOnPercentage ? ` · ${offer.sellOnPercentage}% sell-on` : ""}
            </p>
            {isLoan && offer.loanTerms && (
              <p>
                {offer.loanTerms.durationMonths}-month loan · {offer.loanTerms.wageContributionPercent}% wage
                contribution · {offer.loanTerms.playingTimeExpectation.toLowerCase()} playing time
                {offer.loanTerms.recallOption ? " · recall option" : ""}
              </p>
            )}
            {narrative.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
            {!isTerminal && offer.respondBy && days !== undefined && (
              <p className="subtle">
                {days === 0 ? "A response is due today." : `A response is expected in ${days} day${days === 1 ? "" : "s"}.`}
              </p>
            )}
          </MeetingBrief>

          {options.some((option) => option.id === "counter") && isLoan && (
            <MeetingBrief heading="Revise your proposal">
              <label className="inline-form">
                Wage contribution %
                <input
                  inputMode="numeric"
                  value={counterWage}
                  placeholder={String(offer.loanTerms?.wageContributionPercent ?? "")}
                  onChange={(event) => setCounterWage(event.target.value)}
                />
              </label>
            </MeetingBrief>
          )}

          <MeetingOptions options={options} onChoose={onChoose} busyId={busyId} />

          <MeetingOutcome
            status={{ label: stage.label, tone: stage.tone }}
            history={historyEntries}
          />
      </MeetingShell>
    </article>
  );
};

/**
 * Self-contained entry point for opening one specific negotiation from
 * outside the Transfers screen — e.g. a Story Detail action. Fetches its
 * own TransferCentre rather than requiring the caller to already have one;
 * player/club cross-navigation is a secondary convenience here, so it's
 * inert rather than requiring the caller to wire a full profile stack.
 */
export const TransferNegotiationLauncher = ({
  offerId,
  onClose,
}: {
  offerId: EntityId;
  onClose: () => void;
}): React.ReactElement => {
  const [state, , replace] = useRuntimeData(() => managerBridge.getTransferCentre());
  return (
    <Panel title="Transfer negotiation" className="panel-wide">
      <button className="ghost" onClick={onClose}>
        Close
      </button>
      <AsyncPanel state={state}>
        {(centre) => (
          <TransferNegotiationMeeting
            offerId={offerId}
            centre={centre}
            onClose={onClose}
            onUpdate={replace}
            onSelectPlayer={() => undefined}
            onOpenClub={() => undefined}
          />
        )}
      </AsyncPanel>
    </Panel>
  );
};
