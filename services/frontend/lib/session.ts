export interface FrontendSession {
  accessToken: string;
  email: string;
  name: string;
  userId: string;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  tenantSlug: string;
  onboardingCompleted: boolean;
  userType?: "individual" | "student" | "employee" | null;
  membershipType?: string | null;
}

const SESSION_KEY = "quiz-app-frontend-session";
const SESSION_EVENT = "quiz-app-session-change";

function emitSessionChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EVENT));
  }
}

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
  emitSessionChange();
}

export function clearStoredSession() {
  window.localStorage.removeItem(SESSION_KEY);
  emitSessionChange();
}

export function addSessionListener(listener: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === SESSION_KEY) {
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(SESSION_EVENT, listener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(SESSION_EVENT, listener);
  };
}
