import Link from "next/link";

import { LoginCard } from "../components/login-card";
import { SiteShell } from "../components/site-shell";

const highlights = [
  "Real-time contests with timed questions and automatic progression",
  "Wallet ledger with transaction history and prize credits",
  "Admin publishing, recovery, cache rebuild, and job monitoring",
  "Temporary local email auth until Google OAuth credentials arrive"
];

export default function HomePage() {
  return (
    <SiteShell
      title="A live quiz arena with sharp operations under the hood."
      subtitle="This frontend is connected to the working backend stack right now and is designed as the first real integration layer, not a static mock."
    >
      <section className="hero">
        <div className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow">Production Direction</div>
            <h1>Fast rounds. Clean payout logic. Admin control.</h1>
            <p>
              Build and demo a mobile-first contest experience that feels lively on the surface and
              disciplined underneath. The backend already handles contest lifecycle, ledger safety,
              leaderboard generation, and Redis recovery.
            </p>

            <div className="hero-actions" style={{ marginTop: 20 }}>
              <Link href="/dashboard" className="solid-button">
                Open Player Dashboard
              </Link>
              <Link href="/admin" className="ghost-button">
                Open Admin Console
              </Link>
            </div>
          </div>
        </div>

        <LoginCard />
      </section>

      <section className="grid two">
        <div className="stat-card">
          <div className="eyebrow">What’s Wired</div>
          <div className="list" style={{ marginTop: 16 }}>
            {highlights.map((item) => (
              <div key={item} className="notice">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="eyebrow">Flow</div>
          <h2 className="section-title">How to use this build</h2>
          <div className="list">
            <div className="notice">
              Sign in using one of the demo email identities or any valid email address.
            </div>
            <div className="notice">
              Use the player dashboard to top up wallet balance, join contests, and open live
              rounds.
            </div>
            <div className="notice">
              Use the admin console to create contests, add questions, publish, recover jobs, and
              inspect queue state.
            </div>
          </div>
        </div>
      </section>

      <div className="footer-note">
        Temporary auth and add-money endpoints are explicitly marked in the backend code so they can
        be swapped with Google OAuth and a real gateway later without disturbing the rest of the
        system.
      </div>
    </SiteShell>
  );
}
