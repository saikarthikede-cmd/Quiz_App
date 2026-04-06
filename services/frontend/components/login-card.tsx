"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getGoogleConfig, loginWithGoogle } from "../lib/api";
import { setStoredSession } from "../lib/session";
import { resolveRouteTenantSlug } from "../lib/tenant";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, string | number | boolean>
          ) => void;
        };
      };
    };
  }
}

function loadGoogleScript() {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');

    if (existing) {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google sign-in")), {
        once: true
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google sign-in"));
    document.head.appendChild(script);
  });
}

export function LoginCard({
  onSuccess,
  targetHref = "/",
  tenantSlug
}: {
  onSuccess?: () => void;
  targetHref?: string;
  tenantSlug?: string | null;
}) {
  const router = useRouter();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googlePending, setGooglePending] = useState(false);
  const resolvedTenantSlug = resolveRouteTenantSlug(tenantSlug);

  function completeLogin(result: Awaited<ReturnType<typeof loginWithGoogle>>) {
    const sessionTenantSlug = result.tenant?.slug ?? resolvedTenantSlug ?? "default";
    const nextHref = result.user.is_platform_admin ? "/admin" : targetHref;

    setStoredSession({
      accessToken: result.access_token,
      email: result.user.email,
      name: result.user.name,
      userId: result.user.id,
      isAdmin: result.user.is_admin,
      isPlatformAdmin: result.user.is_platform_admin ?? false,
      tenantSlug: sessionTenantSlug,
      onboardingCompleted: result.user.onboarding_completed ?? Boolean(result.user.is_platform_admin),
      userType: result.user.user_type ?? null,
      membershipType: result.user.membership_type ?? null
    });

    onSuccess?.();

    router.replace(nextHref);
    window.setTimeout(() => {
      router.refresh();
    }, 80);
  }

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const config = await getGoogleConfig();

        if (!active) {
          return;
        }

        setGoogleEnabled(config.enabled && Boolean(config.client_id));
        setGoogleClientId(config.client_id);
      } catch {
        if (active) {
          setGoogleEnabled(false);
          setGoogleClientId(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!googleEnabled || !googleClientId) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        await loadGoogleScript();

        if (!active || !window.google?.accounts?.id) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: ({ credential }) => {
            if (!credential) {
              setError("Google sign-in did not return a credential.");
              return;
            }

            setError(null);
            setGooglePending(true);

            void (async () => {
              try {
                const result = await loginWithGoogle(credential);
                completeLogin(result);
              } catch (loginError) {
                setError(loginError instanceof Error ? loginError.message : "Google sign-in failed");
              } finally {
                setGooglePending(false);
              }
            })();
          }
        });

        setGoogleReady(true);
      } catch (scriptError) {
        if (active) {
          setError(scriptError instanceof Error ? scriptError.message : "Google sign-in is unavailable");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [googleClientId, googleEnabled]);

  useEffect(() => {
    if (!googleReady || !googleButtonRef.current || !window.google?.accounts?.id) {
      return;
    }

    googleButtonRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      type: "standard",
      theme: "filled_blue",
      size: "large",
      text: "continue_with",
      shape: "pill",
      width: "360"
    });
  }, [googleReady]);

  return (
    <div className="login-card">
      <div className="eyebrow">Let&apos;s Get Going</div>
      <h2 className="section-title" style={{ marginTop: 14 }}>
        Sign in and step into the next round
      </h2>
      <p className="muted">
        Use your Google account for a faster entry into contests, wallets, and the live quiz floor.
      </p>

      {googleEnabled ? (
        <div className="google-auth-block">
          <div className="muted-label">Continue with Google</div>
          <div ref={googleButtonRef} className="google-button-slot" />
          {googlePending ? <div className="notice">Signing you in with Google...</div> : null}
        </div>
      ) : (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          Google sign-in is currently unavailable. Please verify the OAuth configuration and try again.
        </div>
      )}

      {error ? (
        <div className="notice error" style={{ marginTop: 14 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
