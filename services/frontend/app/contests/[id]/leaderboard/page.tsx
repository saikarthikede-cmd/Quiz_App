"use client";

import { useParams } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

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
  const params = useParams<{ id: string }>();
  const contestId = params.id;
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getLeaderboard(contestId);
        setRows(result.leaderboard);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load leaderboard");
      }
    });
  }, [contestId]);

  return (
    <SiteShell
      title="Contest Leaderboard"
      subtitle="Final ranking, winners, and prize amounts for the selected contest."
    >
      <div className="card">
        <div className="eyebrow">Contest</div>
        <div className="mono" style={{ marginTop: 12 }}>
          {contestId}
        </div>
      </div>

      {error ? <div className="notice error" style={{ marginTop: 18 }}>{error}</div> : null}

      <div className="list" style={{ marginTop: 18 }}>
        {rows.map((row, index) => (
          <div key={row.user_id} className="contest-card">
            <div className="stack-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: "0 0 6px" }}>
                  #{index + 1} {row.name}
                </h3>
                <div className="pill-row">
                  <span className="pill">Correct {row.correct_count}</span>
                  {row.is_winner ? <span className="pill gold">Winner</span> : null}
                  <span className="pill rose">Prize Rs {row.prize_amount}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </SiteShell>
  );
}
