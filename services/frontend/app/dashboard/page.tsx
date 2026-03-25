"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";

import { LoginCard } from "../../components/login-card";
import { SiteShell } from "../../components/site-shell";
import { useFrontendSession } from "../../components/session-panel";
import { addMoney, getOpenContests, getWalletBalance, joinContest } from "../../lib/api";

interface ContestItem {
  id: string;
  title: string;
  entry_fee: string;
  max_members: number;
  member_count: number;
  starts_at: string;
  prize_pool: string;
}

export default function DashboardPage() {
  const { session, isReady } = useFrontendSession();
  const [walletBalance, setWalletBalance] = useState<string>("0.00");
  const [contests, setContests] = useState<ContestItem[]>([]);
  const [amount, setAmount] = useState("50");
  const [contestLookupId, setContestLookupId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadData(accessToken: string) {
    setError(null);

    try {
      const [walletResult, contestResult] = await Promise.all([
        getWalletBalance(accessToken),
        getOpenContests()
      ]);

      setWalletBalance(walletResult.wallet_balance);
      setContests(contestResult.contests);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
    }
  }

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    startTransition(() => {
      void loadData(session.accessToken);
    });
  }, [session]);

  if (!isReady) {
    return (
      <SiteShell title="Player Dashboard" subtitle="Loading local session...">
        <div className="notice">Checking saved session...</div>
      </SiteShell>
    );
  }

  if (!session) {
    return (
      <SiteShell
        title="Player Dashboard"
        subtitle="Sign in with a valid email address to use wallet, contests, and live gameplay."
      >
        <LoginCard targetHref="/dashboard" />
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="Player Dashboard"
      subtitle="Top up a local wallet, join a live contest, and jump into the real-time game room."
    >
      <div className="grid three">
        <div className="stat-card">
          <div className="eyebrow">Wallet</div>
          <div className="stat-value">Rs {walletBalance}</div>
          <p className="muted">
            Temporary local top-up is active because a payment gateway is not integrated yet.
          </p>
        </div>

        <div className="card">
          <div className="eyebrow">Add Money</div>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Amount</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <button
            type="button"
            className="solid-button"
            onClick={() => {
              setMessage(null);
              setError(null);

              startTransition(async () => {
                try {
                  const result = await addMoney(session.accessToken, Number(amount));
                  setWalletBalance(result.wallet_balance);
                  setMessage(`Wallet updated to Rs ${result.wallet_balance}`);
                } catch (topupError) {
                  setError(topupError instanceof Error ? topupError.message : "Top-up failed");
                }
              });
            }}
          >
            Confirm Add Money
          </button>
        </div>

        <div className="card">
          <div className="eyebrow">Account</div>
          <h3>{session.name}</h3>
          <p className="muted mono">{session.email}</p>
          <div className="pill-row">
            <span className="pill">{session.isAdmin ? "Admin Access" : "Player Access"}</span>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                startTransition(() => {
                  void loadData(session.accessToken);
                });
              }}
            >
              Refresh Data
            </button>
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="eyebrow">Quick Open</div>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Contest ID</span>
            <input
              value={contestLookupId}
              onChange={(event) => setContestLookupId(event.target.value)}
              placeholder="Paste a contest UUID"
            />
          </label>
          <div className="stack-row">
            <Link
              href={contestLookupId ? `/contests/${contestLookupId}/live` : "/dashboard"}
              className="ghost-button"
            >
              Open Live Room
            </Link>
            <Link
              href={contestLookupId ? `/contests/${contestLookupId}/leaderboard` : "/dashboard"}
              className="solid-button"
            >
              Open Leaderboard
            </Link>
          </div>
        </div>

        <div className="card">
          <div className="eyebrow">Testing Note</div>
          <p className="muted" style={{ marginTop: 14 }}>
            Open contests appear below automatically. If a round has already ended, paste its UUID
            here and jump directly into the leaderboard page without going back to terminal commands.
          </p>
        </div>
      </div>

      {message ? <div className="notice" style={{ marginTop: 18 }}>{message}</div> : null}
      {error ? <div className="notice error" style={{ marginTop: 18 }}>{error}</div> : null}

      <section style={{ marginTop: 22 }}>
        <div className="hero-actions" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow">Open Contests</div>
            <h2 className="section-title">Join what is live next</h2>
          </div>
        </div>

        <div className="list">
          {contests.length === 0 ? (
            <div className="notice warn">
              No open contests right now. Create or publish one from the admin console.
            </div>
          ) : null}

          {contests.map((contest) => (
            <article key={contest.id} className="contest-card">
              <div className="stack-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: "0 0 8px" }}>{contest.title}</h3>
                  <div className="contest-meta">
                    <span className="pill gold">Entry Rs {contest.entry_fee}</span>
                    <span className="pill">{contest.member_count}/{contest.max_members} joined</span>
                    <span className="pill rose">Prize Rs {contest.prize_pool}</span>
                  </div>
                </div>

                <div className="stack-row">
                  <button
                    type="button"
                    className="solid-button"
                    onClick={() => {
                      setMessage(null);
                      setError(null);

                      startTransition(async () => {
                        try {
                          const result = await joinContest(session.accessToken, contest.id);
                          setWalletBalance(result.wallet_balance);
                          setMessage(`Joined ${contest.title}. Prize pool is now Rs ${result.prize_pool}.`);
                          await loadData(session.accessToken);
                        } catch (joinError) {
                          setError(joinError instanceof Error ? joinError.message : "Join failed");
                        }
                      });
                    }}
                  >
                    Join Contest
                  </button>

                  <Link href={`/contests/${contest.id}/live`} className="ghost-button">
                    Open Live View
                  </Link>
                </div>
              </div>

              <p className="muted" style={{ marginBottom: 0 }}>
                Starts at {new Date(contest.starts_at).toLocaleString()}
              </p>
              <div className="mono" style={{ marginTop: 10, fontSize: "0.84rem" }}>
                {contest.id}
              </div>
            </article>
          ))}
        </div>
      </section>
    </SiteShell>
  );
}
