import { describe, expect, it } from "vitest";
import { validateWaitlistRequest } from "../../src/core/waitlist.js";

describe("waitlist validation", () => {
  it("normalizes a valid request", () => expect(validateWaitlistRequest({ email: " DEV@Example.COM ", planInterest: "annual" })).toEqual({ email: "dev@example.com", planInterest: "annual" }));
  it("rejects invalid email and plan", () => {
    expect(() => validateWaitlistRequest({ email: "not-an-email", planInterest: "annual" })).toThrow(/email/);
    expect(() => validateWaitlistRequest({ email: "dev@example.com", planInterest: "bad" as "annual" })).toThrow(/plan/);
  });
});
