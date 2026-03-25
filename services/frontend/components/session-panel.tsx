"use client";

import { useEffect, useState } from "react";

import { getStoredSession, type FrontendSession } from "../lib/session";

export function useFrontendSession() {
  const [session, setSession] = useState<FrontendSession | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setSession(getStoredSession());
    setIsReady(true);
  }, []);

  return { session, setSession, isReady };
}
