"use client";

import { useEffect, useState } from "react";

import { addSessionListener, getStoredSession, type FrontendSession } from "../lib/session";

export function useFrontendSession() {
  const [session, setSession] = useState<FrontendSession | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const syncSession = () => {
      setSession(getStoredSession());
      setIsReady(true);
    };

    syncSession();
    return addSessionListener(syncSession);
  }, []);

  return { session, setSession, isReady };
}
