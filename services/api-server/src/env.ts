const toNumber = (value: string | undefined, fallback: number) =>
  value ? Number(value) : fallback;

const parseCsv = (...values: Array<string | undefined>) =>
  values
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

const normalizeCookieDomain = (value: string | undefined) => {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized === "localhost" || normalized === "127.0.0.1") {
    return undefined;
  }

  return normalized;
};

export const config = {
  apiPort: toNumber(process.env.API_PORT, 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  frontendUrls: [
    ...new Set(
      parseCsv(
        process.env.FRONTEND_URL,
        process.env.FRONTEND_URLS,
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
      )
    )
  ],
  jwtSecret: process.env.JWT_SECRET ?? "replace_me",
  jwtIssuer: process.env.JWT_ISSUER ?? "quiz-app",
  jwtAudience: process.env.JWT_AUDIENCE ?? "quiz-app-users",
  accessTokenTtlMinutes: toNumber(process.env.ACCESS_TOKEN_TTL_MINUTES, 15),
  refreshTokenTtlDays: toNumber(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  otpTtlMinutes: toNumber(process.env.AUTH_OTP_TTL_MINUTES, 5),
  otpMaxAttempts: toNumber(process.env.AUTH_OTP_MAX_ATTEMPTS, 5),
  otpDeliveryMode: process.env.AUTH_OTP_DELIVERY ?? "server_log",
  otpExposeInResponse:
    process.env.AUTH_OTP_EXPOSE_IN_RESPONSE !== undefined
      ? process.env.AUTH_OTP_EXPOSE_IN_RESPONSE === "true"
      : process.env.NODE_ENV !== "production",
  otpAllowedEmails: parseCsv(process.env.AUTH_ALLOWED_EMAILS).map((value) => value.toLowerCase()),
  otpAllowedDomains: parseCsv(process.env.AUTH_ALLOWED_EMAIL_DOMAINS).map((value) =>
    value.toLowerCase()
  ),
  cookieDomain: normalizeCookieDomain(process.env.COOKIE_DOMAIN),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  adminEmail: (process.env.ADMIN_EMAIL ?? "admin.quiz@gmail.com").toLowerCase(),
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? ""
};
