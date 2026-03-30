"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";

import { LoginCard } from "./login-card";
import { addSessionListener, clearStoredSession, getStoredSession, type FrontendSession } from "../lib/session";

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

  useEffect(() => {
    const syncSession = () => {
      setSession(getStoredSession());
    };

    syncSession();
    return addSessionListener(syncSession);
  }, []);

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link href="/" className="brand">
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
            <Link href="/" className={clsx("nav-link", pathname === "/" && "solid-button")}>
              Home
            </Link>
            <Link
              href="/dashboard"
              className={clsx("nav-link", pathname === "/dashboard" && "solid-button")}
            >
              Dashboard
            </Link>
            <Link
              href="/admin"
              className={clsx("nav-link", pathname === "/admin" && "solid-button")}
            >
              Admin
            </Link>
            {session ? (
              <>
                <span className="pill gold">{session.email}</span>
                <button
                  type="button"
                  className="logout-button"
                  onClick={() => {
                    clearStoredSession();
                    setSession(null);
                    router.push("/");
                  }}
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                type="button"
                className="solid-button"
                onClick={() => setLoginOpen(true)}
              >
                Sign In
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="container section">
        <div className="page-banner" style={{ marginBottom: 24 }}>
          <div className="status-marquee">
            <span className="status-dot" />
            <span className="muted-label">Live Build Signal</span>
            <span className="muted">Frontend integrated with API, worker, game server, Redis, and Postgres.</span>
          </div>

          <div className="page-banner-grid">
            <div className="hero-copy card compact">
              <div className="eyebrow">Frontend Integration</div>
              <h1 className="section-title">{title}</h1>
              <p className="muted">{subtitle}</p>
            </div>

            <div className="card">
              <div className="eyebrow">Current Session</div>
              <div className="mini-stat-grid" style={{ marginTop: 16 }}>
                <div className="mini-stat">
                  <span className="muted-label">Mode</span>
                  <strong>{session ? (session.isAdmin ? "Admin" : "Player") : "Ready"}</strong>
                </div>
                <div className="mini-stat">
                  <span className="muted-label">Route</span>
                  <strong className="mono">{pathname}</strong>
                </div>
              </div>
              <div className="hero-note muted">
                This build keeps the live backend flows intact while presenting a brighter event-ready surface for local and LAN testing.
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
              targetHref={pathname === "/admin" ? "/admin" : "/dashboard"}
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
