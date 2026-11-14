import { describe, expect, it, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
vi.mock("./modules", () => ({ moduleCall: call }));

import { emailDoor } from "./email";

describe("email delivery outcomes", () => {
  it.each([
    [202, "", false, "sent"],
    [503, "EMAIL_SENDER_NOT_CONFIGURED", false, "not-sent"],
    [502, "EMAIL_OUTCOME_UNKNOWN", false, "unknown"],
    [409, "IDEMPOTENCY_PENDING", false, "unknown"],
    [0, "", true, "not-sent"],
    [0, "", false, "unknown"],
  ])("keeps status %s and code %s honest", async (status, code, unreached, expected) => {
    call.mockResolvedValue({
      status,
      unreached,
      body: Buffer.from(JSON.stringify({ error: code })),
    });
    expect(
      (
        await emailDoor.send(
          { to: "test@example.test", subject: "Test", text: "Test" },
          "one-durable-key",
        )
      ).status,
    ).toBe(expected);
    expect(call).toHaveBeenLastCalledWith(
      "POST",
      "/v1/email",
      expect.any(Buffer),
      "one-durable-key",
    );
  });
});
