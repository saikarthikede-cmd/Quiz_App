"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";

import { clearStoredSession, getStoredSession, type FrontendSession } from "../lib/session";

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

  useEffect(() => {
    setSession(getStoredSession());
  }, [pathname]);

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">Q</span>
            <span>Quiz Arena</span>
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
                  className="ghost-button"
                  onClick={() => {
                    clearStoredSession();
                    setSession(null);
                    router.push("/");
                    router.refresh();
                  }}
                >
                  Logout
                </button>
              </>
            ) : (
              <span className="pill rose">Guest Mode</span>
            )}
          </nav>
        </div>
      </header>

      <main className="container section">
        <div className="hero-copy card" style={{ marginBottom: 24 }}>
          <div className="eyebrow">Frontend Integration</div>
          <h1 className="section-title">{title}</h1>
          <p className="muted">{subtitle}</p>
        </div>

        {children}
      </main>
    </div>
  );
}
