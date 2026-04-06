"use client";

import { useParams, useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

import { useFrontendSession } from "../../../../components/session-panel";
import { SiteShell } from "../../../../components/site-shell";
import { getLeaderboard } from "../../../../lib/api";

interface LeaderboardRow {
  user_id: string;
  name: string;
  avatar_url: string | null;
  correct_count: string;
  is_winner: boolean;
  prize_amount: string;
}

export default function LeaderboardPage() {
  const params = useParams<{ slug?: string; id: string }>();
  const router = useRouter();
  const tenantSlug = typeof params.slug === "string" ? params.slug : null;
  const contestId = params.id;
  const { isReady } = useFrontendSession();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const winnerCount = rows.filter((row) => row.is_winner).length;
  const totalPrize = rows
    .reduce((sum, row) => sum + Number(row.prize_amount ?? 0), 0)
    .toFixed(2);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (!tenantSlug) {
      router.replace("/");
    }
  }, [isReady, router, tenantSlug]);

  useEffect(() => {
    if (!tenantSlug) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await getLeaderboard(contestId);
        setRows(result.leaderboard);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load leaderboard");
      }
    });
  }, [contestId, tenantSlug]);

  if (!tenantSlug) {
    return (
      <SiteShell title="Contest Leaderboard" subtitle="Resolving organization workspace...">
        <div className="notice">Redirecting to organization selection...</div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="Contest Leaderboard"
      subtitle="Final ranking, winners, and prize amounts for the selected contest, laid out like a proper event wrap-up instead of a plain list."
    >
      <div className="page-banner-grid">
        <div className="card">
          <div className="eyebrow">Contest</div>
          <div className="mono" style={{ marginTop: 12 }}>
            {contestId}
          </div>
        </div>
        <div className="signal-grid">
          <div className="signal-card">
            <div className="signal-label">Entries</div>
            <div className="signal-value">{rows.length}</div>
          </div>
          <div className="signal-card gold">
            <div className="signal-label">Winners</div>
            <div className="signal-value">{winnerCount}</div>
          </div>
          <div className="signal-card rose">
            <div className="signal-label">Total Payout</div>
            <div className="signal-value">Rs {totalPrize}</div>
          </div>
        </div>
      </div>

      {error ? <div className="notice error" style={{ marginTop: 18 }}>{error}</div> : null}

      <div className="leaderboard-grid" style={{ marginTop: 18 }}>
        {rows.map((row, index) => (
          <div key={row.user_id} className="contest-card leaderboard-row">
            <div className={`rank-badge ${index === 0 ? "gold" : ""}`}>#{index + 1}</div>
            <div>
              <h3 style={{ margin: "0 0 6px" }}>
                {row.name}
              </h3>
              <div className="pill-row">
                <span className="pill">Correct {row.correct_count}</span>
                {row.is_winner ? <span className="pill gold">Winner</span> : null}
                <span className="pill rose">Prize Rs {row.prize_amount}</span>
              </div>
            </div>
            <div className="muted-label">
              {row.avatar_url ? "Avatar linked" : "No avatar"}
            </div>
          </div>
        ))}
      </div>
    </SiteShell>
  );
}
