const toNumber = (value: string | undefined, fallback: number) =>
  value ? Number(value) : fallback;

export const config = {
  apiPort: toNumber(process.env.API_PORT, 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET ?? "replace_me",
  jwtIssuer: process.env.JWT_ISSUER ?? "quiz-app",
  jwtAudience: process.env.JWT_AUDIENCE ?? "quiz-app-users",
  accessTokenTtlMinutes: toNumber(process.env.ACCESS_TOKEN_TTL_MINUTES, 15),
  refreshTokenTtlDays: toNumber(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  cookieDomain: process.env.COOKIE_DOMAIN ?? "localhost",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  adminEmail: (process.env.ADMIN_EMAIL ?? "admin.quiz@gmail.com").toLowerCase()
};
