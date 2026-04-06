"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";

import { LoginCard } from "./login-card";
import { logout } from "../lib/api";
import { addSessionListener, clearStoredSession, getStoredSession, type FrontendSession } from "../lib/session";
import { buildTenantPath, extractTenantSlugFromPath } from "../lib/tenant";

export function SiteShell({
  children,
  title,
  subtitle
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<FrontendSession | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const routeTenantSlug = extractTenantSlugFromPath(pathname);
  const activeTenantSlug = routeTenantSlug ?? session?.tenantSlug ?? null;
  const isPlatformSurface = !routeTenantSlug && Boolean(session?.isPlatformAdmin);
  const tenantHomeHref = isPlatformSurface ? "/admin" : buildTenantPath(activeTenantSlug);
  const tenantDashboardHref = isPlatformSurface ? "/admin" : buildTenantPath(activeTenantSlug, "/dashboard");
  const tenantAdminHref = isPlatformSurface ? "/admin" : buildTenantPath(activeTenantSlug, "/admin");
  const tenantLoginHref = isPlatformSurface ? "/" : buildTenantPath(activeTenantSlug, "/login");

  useEffect(() => {
    const syncSession = () => {
      setSession(getStoredSession());
    };

    syncSession();
    return addSessionListener(syncSession);
  }, []);

  useEffect(() => {
    if (!routeTenantSlug || !session || session.tenantSlug === routeTenantSlug || session.isPlatformAdmin) {
      return;
    }

    clearStoredSession();
    setSession(null);
    router.replace(buildTenantPath(routeTenantSlug, "/login"));
  }, [routeTenantSlug, router, session]);

  useEffect(() => {
    if (!routeTenantSlug || !session || session.isPlatformAdmin || session.onboardingCompleted) {
      return;
    }

    router.replace("/");
  }, [routeTenantSlug, router, session]);

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link href={tenantHomeHref} className="brand">
            <span className="brand-mark">
              <span className="brand-mark-core">Q</span>
              <span className="brand-mark-spark" />
            </span>
            <span className="brand-copy">
              <strong>Quiz Master</strong>
              <small>Live contests and wallet-ready play</small>
            </span>
          </Link>

          <nav className="nav-links">
            {session?.isPlatformAdmin && routeTenantSlug ? (
              <Link href="/admin" className={clsx("nav-link", pathname === "/admin" && "nav-link-active")}>
                Main Console
              </Link>
            ) : null}
            <Link href={tenantHomeHref} className={clsx("nav-link", pathname === tenantHomeHref && "nav-link-active")}>
              Home
            </Link>
            <Link
              href={tenantDashboardHref}
              className={clsx("nav-link", pathname === tenantDashboardHref && "nav-link-active")}
            >
              Dashboard
            </Link>
            {session?.isAdmin ? (
              <Link
                href={tenantAdminHref}
                className={clsx("nav-link", pathname === tenantAdminHref && "nav-link-active")}
              >
                Admin
              </Link>
            ) : null}
            {session ? (
              <>
                <span className="pill gold">{session.name}</span>
                <button
                  type="button"
                  className="logout-button"
                  disabled={isLoggingOut}
                  onClick={async () => {
                    setIsLoggingOut(true);

                    try {
                      await logout();
                    } finally {
                      clearStoredSession();
                      setSession(null);
                      setIsLoggingOut(false);
                      router.push(tenantLoginHref);
                    }
                  }}
                >
                  {isLoggingOut ? "Signing out..." : "Logout"}
                </button>
              </>
            ) : (
              routeTenantSlug ? (
                <button
                  type="button"
                  className="solid-button"
                  onClick={() => setLoginOpen(true)}
                >
                  Sign In
                </button>
              ) : (
                <Link href="/" className="solid-button">
                  Sign In
                </Link>
              )
            )}
          </nav>
        </div>
      </header>

      <main className="container section">
        <div className="page-banner page-banner-grid" style={{ marginBottom: 24 }}>
          <div className="hero-copy card compact page-hero-card">
            <div className="eyebrow">{routeTenantSlug ? `${routeTenantSlug} workspace` : "Quiz Master"}</div>
            <h1 className="section-title">{title}</h1>
            {subtitle ? <p className="muted hero-kicker">{subtitle}</p> : null}
            <div className="hero-footnote">
              <span className="pill gold">{session ? "Signed in" : "Guest view"}</span>
              <span className="pill">
                {session?.isPlatformAdmin
                  ? "Main admin access"
                  : session?.isAdmin
                    ? "Admin access"
                    : routeTenantSlug
                      ? "Contest-ready flow"
                      : "Sign in to continue"}
              </span>
            </div>
          </div>

          <div className="card hero-rail">
            <div className="hero-rail-top">
              <div className="eyebrow">Workspace Focus</div>
              {routeTenantSlug ? <span className="pill">{routeTenantSlug}</span> : null}
            </div>
            <div className="hero-rail-grid">
              <div className="rail-card">
                <div className="rail-label">Flow</div>
                <div className="rail-value">{session ? "Ready to move" : "Sign in to begin"}</div>
                <div className="rail-copy">
                  {session
                    ? "Open contests, track rankings, and jump straight into live gameplay."
                    : "Enter through one global sign-in, then continue into the correct company or college workspace."}
                </div>
              </div>
              <div className="rail-card">
                <div className="rail-label">Navigation</div>
                <div className="rail-copy">
                  Home, dashboard, admin, live room, and leaderboard views stay grouped inside one cleaner shell.
                </div>
              </div>
            </div>
          </div>
        </div>

        {children}
      </main>

      {!session && loginOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card auth-modal-card">
            <div className="stack-row spread" style={{ marginBottom: 14 }}>
              <div>
                <div className="eyebrow">Sign In</div>
                <h3 style={{ marginTop: 14, marginBottom: 6 }}>Welcome to Quiz Master</h3>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setLoginOpen(false)}
              >
                Close
              </button>
            </div>
            <LoginCard
              tenantSlug={routeTenantSlug}
              targetHref={pathname}
              onSuccess={() => {
                setSession(getStoredSession());
                setLoginOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
