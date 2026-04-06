"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { SiteShell } from "../../../components/site-shell";
import { getPublicUserRanking } from "../../../lib/api";
import { buildTenantPath } from "../../../lib/tenant";

interface RankingEntry {
  user_id: string;
  name: string;
  rank: string;
}

export default function TenantHomePage() {
  const params = useParams<{ slug: string }>();
  const tenantSlug = typeof params.slug === "string" ? params.slug : null;
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantSlug) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const result = await getPublicUserRanking();
        if (!active) {
          return;
        }

        setRanking(result.ranking);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load org ranking");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [tenantSlug]);

  return (
    <SiteShell
      title={`Quiz Master - ${tenantSlug ?? "org"}`}
      subtitle="Join live quiz contests, answer timed questions, and track the strongest names in this workspace from one sharper front door."
    >
      <section className="hero">
        <div className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow">Live Quiz Arena</div>
            <h1>Compete live. Answer fast. Win real prizes.</h1>
            <p>Sign in to join contests, manage your wallet, and follow live quiz action with a faster, cleaner workspace flow.</p>

            <div className="hero-actions" style={{ marginTop: 20 }}>
              <Link href={buildTenantPath(tenantSlug, "/dashboard")} className="solid-button">
                Open Dashboard
              </Link>
              <Link href={buildTenantPath(tenantSlug, "/login")} className="ghost-button">
                Tenant Login
              </Link>
            </div>

            <div className="metric-strip">
              <div className="metric-chip">
                <span className="rail-label">Contest Type</span>
                <strong>Timed live rooms</strong>
              </div>
              <div className="metric-chip">
                <span className="rail-label">Entry</span>
                <strong>Wallet-backed joins</strong>
              </div>
              <div className="metric-chip">
                <span className="rail-label">Finish</span>
                <strong>Leaderboard and payout</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="card home-side-panel hero-rail">
          <div className="hero-rail-top">
            <div className="eyebrow">Org Ranking</div>
            <span className="pill gold">{tenantSlug ?? "workspace"}</span>
          </div>
          <h2 className="section-title" style={{ marginTop: 4 }}>
            Top users in this workspace
          </h2>
          <div className="rank-list" style={{ marginTop: 18 }}>
            {error ? <div className="notice error">{error}</div> : null}
            {ranking.length === 0 && !error ? (
              <div className="notice">No ranking available yet.</div>
            ) : null}
            {ranking.map((entry) => (
              <div key={entry.user_id} className="rank-row">
                <div className="rank-index">{entry.rank}</div>
                <div className="rank-name">
                  <strong>{entry.name}</strong>
                  <div className="rank-subtitle">Workspace ranking</div>
                </div>
                <span className="pill gold">Top {entry.rank}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
