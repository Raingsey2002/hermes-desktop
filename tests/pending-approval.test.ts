import { describe, it, expect } from "vitest";
import {
  registerPendingApproval,
  resolvePendingApproval,
  clearPendingApproval,
} from "../src/main/hermes";

/**
 * Bookkeeping for mid-turn `approval.request` handshakes (W4-6). Mirrors the
 * existing `pendingClarify` map one-for-one: a resolver is registered when
 * the request arrives, fired exactly once when the renderer answers, and
 * `resolvePendingApproval` reports whether anything was actually waiting —
 * the signal the IPC handler uses to tell the renderer "delivered" from
 * "the turn already ended, nobody was listening."
 */
// @lat: [[confirmation-ui#Agent confirmation requests#Structured approval card (W4-6)#Pending-approval registry (W4-6)]]
describe("pending approval registry", () => {
  it("fires the registered resolver exactly once with the given decision", () => {
    const decisions: string[] = [];
    registerPendingApproval("req-1", (decision) => decisions.push(decision));

    const delivered = resolvePendingApproval("req-1", "once");

    expect(delivered).toBe(true);
    expect(decisions).toEqual(["once"]);
  });

  it("is one-shot: a second resolve for the same id reports not-delivered", () => {
    registerPendingApproval("req-2", () => undefined);
    expect(resolvePendingApproval("req-2", "once")).toBe(true);
    expect(resolvePendingApproval("req-2", "deny")).toBe(false);
  });

  it("resolving an unknown request id reports not-delivered (never throws)", () => {
    expect(resolvePendingApproval("never-registered", "once")).toBe(false);
  });

  it("clearPendingApproval drops a resolver without firing it", () => {
    const decisions: string[] = [];
    registerPendingApproval("req-3", (decision) => decisions.push(decision));

    clearPendingApproval("req-3");

    expect(resolvePendingApproval("req-3", "once")).toBe(false);
    expect(decisions).toEqual([]);
  });

  it("distinct request ids resolve independently", () => {
    const decisions: Record<string, string> = {};
    registerPendingApproval("a", (d) => (decisions.a = d));
    registerPendingApproval("b", (d) => (decisions.b = d));

    resolvePendingApproval("b", "deny");

    expect(decisions).toEqual({ b: "deny" });
    // "a" is still pending — resolving it now still works.
    expect(resolvePendingApproval("a", "once")).toBe(true);
    expect(decisions).toEqual({ a: "once", b: "deny" });
  });
});
