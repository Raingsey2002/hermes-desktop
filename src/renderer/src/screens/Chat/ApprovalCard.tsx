import { memo, useState } from "react";
import { useI18n } from "../../components/useI18n";
import type { ApprovalMessage } from "./types";

/** Decision sent for the Deny button; any other value approves once. */
const DENY_DECISION = "deny";
const APPROVE_DECISION = "once";

interface ApprovalCardProps {
  msg: ApprovalMessage;
  /** Mark the card resolved in parent state once the user decides. */
  onResolved: (requestId: string, decision: string) => void;
}

/**
 * Inline card for a mid-turn `approval.request` (W4-6). Renders the agent's
 * confirmation message plus Approve/Deny controls — and any extra `choices`
 * the request carried, as additional buttons — then forwards the decision to
 * the main process via `respondApproval` and flips to a resolved, read-only
 * state. Mirrors ClarifyCard.tsx; kept as a separate component/message kind
 * since approval and clarification are distinct gateway request types with
 * different resolution semantics (a decision, not free-form text).
 */
export const ApprovalCard = memo(function ApprovalCard({
  msg,
  onResolved,
}: ApprovalCardProps): React.JSX.Element {
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const resolved = !!msg.resolved;

  const submit = async (decision: string): Promise<void> => {
    if (resolved || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      const ok = await window.hermesAPI.respondApproval(
        msg.requestId,
        decision,
      );
      // The IPC handler returns false when no pending request matched (e.g.
      // the turn already ended) — only flip to resolved on confirmed delivery,
      // same guard ClarifyCard uses, so a dropped response doesn't silently
      // read as "handled" while the agent is still actually waiting.
      if (ok === false) {
        setError(true);
        return;
      }
      onResolved(msg.requestId, decision);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (resolved) {
    return (
      <div className="chat-approval-card chat-approval-card--resolved">
        <div className="chat-approval-message">{msg.message}</div>
        <div className="chat-approval-decision">
          {msg.decision === DENY_DECISION
            ? t("chat.approval.denied")
            : t("chat.approval.approved", {
                decision: msg.decision || APPROVE_DECISION,
              })}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-approval-card" role="alert">
      <div className="chat-approval-message">
        {msg.message || t("chat.approval.defaultMessage")}
      </div>
      {msg.tool && (
        <div className="chat-approval-tool">
          {t("chat.approval.toolLabel", { tool: msg.tool })}
        </div>
      )}

      <div className="chat-approval-actions">
        <button
          type="button"
          className="chat-approval-btn chat-approval-approve"
          disabled={submitting}
          onClick={() => void submit(APPROVE_DECISION)}
        >
          {t("chat.approval.approve")}
        </button>
        <button
          type="button"
          className="chat-approval-btn chat-approval-deny"
          disabled={submitting}
          onClick={() => void submit(DENY_DECISION)}
        >
          {t("chat.approval.deny")}
        </button>
        {msg.choices.map((choice, i) => (
          <button
            type="button"
            key={`${msg.requestId}-${i}`}
            className="chat-approval-btn chat-approval-choice"
            disabled={submitting}
            onClick={() => void submit(choice)}
          >
            {choice}
          </button>
        ))}
      </div>

      {error && (
        <div className="chat-approval-error" role="alert">
          {t("chat.approval.error")}
        </div>
      )}
    </div>
  );
});
