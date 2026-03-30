import Link from "next/link";

import { SiteShell } from "../components/site-shell";

const highlights = [
  "Real-time contests with timed questions and automatic progression",
  "Wallet ledger with transaction history and prize credits",
  "Admin publishing, recovery, cache rebuild, and job monitoring",
  "Fast sign-in flow designed to get players into contests quickly"
];

export default function HomePage() {
  return (
    <SiteShell
      title="A live quiz arena with a brighter, cleaner, demo-ready surface."
      subtitle="This frontend stays connected to the same working backend stack, but the presentation is lighter, easier to scan, and less noisy during testing."
    >
      <section className="hero">
        <div className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow">Live Demo Build</div>
            <h1>Fast rounds. Clean flows. Strong backend control.</h1>
            <p>
              Use a mobile-first contest experience that feels easier to navigate on the surface
              while the backend still handles contest lifecycle, wallet ledger, leaderboard, and
              Redis recovery rules underneath.
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

        <div className="card home-side-panel">
          <div className="eyebrow">Start Here</div>
          <h2 className="section-title" style={{ marginTop: 16 }}>
            Let&apos;s get you into the arena
          </h2>
          <p className="muted">
            Use the sign-in button in the top bar to open a quick access window, then head straight into the player dashboard or admin console.
          </p>
          <div className="list" style={{ marginTop: 18 }}>
            <div className="notice">
              Pick one of the ready profiles or use your own email and name to continue.
            </div>
            <div className="notice">
              Jump into wallet actions, open contests, live gameplay, and leaderboard views from the same flow.
            </div>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="stat-card">
          <div className="eyebrow">What&apos;s Wired</div>
          <div className="list" style={{ marginTop: 16 }}>
            {highlights.map((item) => (
              <div key={item} className="notice">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="eyebrow">Runbook</div>
          <h2 className="section-title">How to move through the demo</h2>
          <div className="list">
            <div className="notice">
              Open the sign-in window from the top bar, choose a profile, and continue into the app in a few quick steps.
            </div>
            <div className="notice">
              Use the player dashboard to top up wallet balance, join contests, and enter the live
              room before the worker broadcasts questions.
            </div>
            <div className="notice">
              Use the admin console to create contests, add questions, publish, recover jobs, and
              inspect queue state.
            </div>
          </div>
        </div>
      </section>

      <div className="footer-note">
        The experience now starts from a cleaner sign-in modal so the landing page stays focused on the product itself.
      </div>
    </SiteShell>
  );
}
