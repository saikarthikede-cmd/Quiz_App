export interface FrontendSession {
  accessToken: string;
  email: string;
  name: string;
  userId: string;
  isAdmin: boolean;
}

const SESSION_KEY = "quiz-app-frontend-session";

export function getStoredSession(): FrontendSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as FrontendSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function setStoredSession(session: FrontendSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  window.localStorage.removeItem(SESSION_KEY);
}
