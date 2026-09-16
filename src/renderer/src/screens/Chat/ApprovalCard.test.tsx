import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub i18n so the card renders in isolation; keys come back verbatim
// (interpolations dropped for simplicity — tests assert on the key text).
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

import { ApprovalCard } from "./ApprovalCard";
import type { ApprovalMessage } from "./types";

afterEach(cleanup);

function stubRespond(): ReturnType<typeof vi.fn> {
  const respondApproval = vi.fn().mockResolvedValue(true);
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    respondApproval,
  };
  return respondApproval;
}

function baseMsg(overrides: Partial<ApprovalMessage> = {}): ApprovalMessage {
  return {
    id: "approval-r1",
    kind: "approval",
    role: "agent",
    requestId: "r1",
    message: "Run `rm -rf build/`?",
    choices: [],
    ...overrides,
  };
}

// @lat: [[confirmation-ui#Agent confirmation requests#Structured approval card (W4-6)]]
describe("ApprovalCard", () => {
  it("Approve sends the once decision", async () => {
    const respondApproval = stubRespond();
    const onResolved = vi.fn();
    render(<ApprovalCard msg={baseMsg()} onResolved={onResolved} />);

    fireEvent.click(screen.getByText("chat.approval.approve"));

    expect(respondApproval).toHaveBeenCalledWith("r1", "once");
    await vi.waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith("r1", "once"),
    );
  });

  it("Deny sends the deny decision", async () => {
    const respondApproval = stubRespond();
    const onResolved = vi.fn();
    render(<ApprovalCard msg={baseMsg()} onResolved={onResolved} />);

    fireEvent.click(screen.getByText("chat.approval.deny"));

    expect(respondApproval).toHaveBeenCalledWith("r1", "deny");
    await vi.waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith("r1", "deny"),
    );
  });

  it("renders one extra button per request-supplied choice", async () => {
    const respondApproval = stubRespond();
    const onResolved = vi.fn();
    render(
      <ApprovalCard
        msg={baseMsg({ choices: ["always"] })}
        onResolved={onResolved}
      />,
    );

    fireEvent.click(screen.getByText("always"));

    expect(respondApproval).toHaveBeenCalledWith("r1", "always");
    await vi.waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith("r1", "always"),
    );
  });

  it("shows the tool name when the request carried one", () => {
    stubRespond();
    render(
      <ApprovalCard msg={baseMsg({ tool: "shell" })} onResolved={vi.fn()} />,
    );
    expect(screen.getByText("chat.approval.toolLabel")).toBeTruthy();
  });

  it("a resolved card shows the decision and exposes no controls", () => {
    const respondApproval = stubRespond();
    render(
      <ApprovalCard
        msg={baseMsg({ resolved: true, decision: "once" })}
        onResolved={vi.fn()}
      />,
    );

    expect(screen.getByText("chat.approval.approved")).toBeTruthy();
    expect(screen.queryByText("chat.approval.approve")).toBeNull();
    expect(screen.queryByText("chat.approval.deny")).toBeNull();
    expect(respondApproval).not.toHaveBeenCalled();
  });

  it("a resolved-deny card shows the denied state", () => {
    stubRespond();
    render(
      <ApprovalCard
        msg={baseMsg({ resolved: true, decision: "deny" })}
        onResolved={vi.fn()}
      />,
    );
    expect(screen.getByText("chat.approval.denied")).toBeTruthy();
  });

  it("does not resolve the card when delivery fails (respondApproval -> false)", async () => {
    const respondApproval = vi.fn().mockResolvedValue(false);
    (window as unknown as { hermesAPI: unknown }).hermesAPI = {
      respondApproval,
    };
    const onResolved = vi.fn();
    render(<ApprovalCard msg={baseMsg()} onResolved={onResolved} />);

    fireEvent.click(screen.getByText("chat.approval.approve"));

    // No pending request matched → card must NOT be marked resolved, and an
    // error must surface so the user can retry — never a silent auto-approve.
    await vi.waitFor(() =>
      expect(screen.getByText("chat.approval.error")).toBeTruthy(),
    );
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByText("chat.approval.approve")).toBeTruthy();
  });

  it("does not resolve the card when the IPC call rejects", async () => {
    const respondApproval = vi.fn().mockRejectedValue(new Error("ipc down"));
    (window as unknown as { hermesAPI: unknown }).hermesAPI = {
      respondApproval,
    };
    const onResolved = vi.fn();
    render(<ApprovalCard msg={baseMsg()} onResolved={onResolved} />);

    fireEvent.click(screen.getByText("chat.approval.deny"));

    await vi.waitFor(() =>
      expect(screen.getByText("chat.approval.error")).toBeTruthy(),
    );
    expect(onResolved).not.toHaveBeenCalled();
  });
});
