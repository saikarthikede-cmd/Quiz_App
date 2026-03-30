import { createHash, randomInt } from "node:crypto";

import { config } from "../env.js";

export function generateOtpCode() {
  return String(randomInt(100000, 1000000));
}

export function hashOtpCode(email: string, otp: string) {
  return createHash("sha256").update(`${email}:${otp}`).digest("hex");
}

export function isAllowedOtpEmail(email: string) {
  if (config.otpAllowedEmails.length === 0 && config.otpAllowedDomains.length === 0) {
    return true;
  }

  if (config.otpAllowedEmails.includes(email)) {
    return true;
  }

  const [, domain = ""] = email.split("@");
  return config.otpAllowedDomains.includes(domain.toLowerCase());
}
