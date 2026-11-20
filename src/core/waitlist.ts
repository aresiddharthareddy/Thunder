export type WaitlistInterest = "annual" | "monthly" | "team";

export interface WaitlistRequest {
  email: string;
  planInterest: WaitlistInterest;
}

export function validateWaitlistRequest(request: WaitlistRequest): WaitlistRequest {
  const email = request.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
  if (!["annual", "monthly", "team"].includes(request.planInterest)) throw new Error("Select a valid plan interest");
  return { email, planInterest: request.planInterest };
}
