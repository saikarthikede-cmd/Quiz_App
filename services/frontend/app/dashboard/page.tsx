"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LoginCard } from "../../components/login-card";
import { SiteShell } from "../../components/site-shell";
import { useFrontendSession } from "../../components/session-panel";
import {
  getOpenContests,
  getMyAccessRequests,
  getUserRanking,
  getWalletBalance,
  getWalletLedger,
  joinContest,
  requestAdminAccess,
  requestAddMoney,
  requestExit,
  requestRedeem
} from "../../lib/api";
import { buildTenantPath } from "../../lib/tenant";

interface ContestItem {
  id: string;
  title: string;
  entry_fee: string;
  max_members: number;
  member_count: number;
  starts_at: string;
  prize_pool: string;
}

interface WalletLedgerEntry {
  id: string;
  type: "credit" | "debit";
  reason: string;
  amount: string;
  balance_before: string;
  balance_after: string;
  reference_id: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

interface RankingEntry {
  user_id: string;
  name: string;
  rank: string;
}

interface AccessRequestEntry {
  id: string;
  request_type: "admin_access" | "exit";
  status: "pending" | "approved" | "rejected";
  notes: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}

type WalletActionMode = "add" | "redeem";

interface WalletActionForm {
  amount: string;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatReason(reason: string) {
  switch (reason) {
    case "topup":
    case "manual_topup":
      return "Add Money";
    case "entry_fee":
      return "Contest Join";
    case "prize":
      return "Prize Credit";
    case "refund":
      return "Refund";
    default:
      return reason.replace(/_/g, " ");
  }
}

export default function DashboardPage() {
  const params = useParams<{ slug?: string }>();
  const router = useRouter();
  const tenantSlug = typeof params.slug === "string" ? params.slug : null;
  const { session, isReady } = useFrontendSession();
  const [walletBalance, setWalletBalance] = useState<string>("0.00");
  const [walletLedger, setWalletLedger] = useState<WalletLedgerEntry[]>([]);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequestEntry[]>([]);
  const [contests, setContests] = useState<ContestItem[]>([]);
  const [contestLookupId, setContestLookupId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletModalMode, setWalletModalMode] = useState<WalletActionMode | null>(null);
  const [walletLedgerOpen, setWalletLedgerOpen] = useState(false);
  const [walletActionPending, setWalletActionPending] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const latestLoadId = useRef(0);
  const [walletActionForm, setWalletActionForm] = useState<WalletActionForm>({
    amount: "50"
  });

  async function loadData(accessToken: string) {
    const loadId = ++latestLoadId.current;
    setPageLoading(true);
    setError(null);

    try {
      const [walletResult, contestResult, ledgerResult, rankingResult, requestsResult] = await Promise.all([
        getWalletBalance(accessToken),
        getOpenContests(),
        getWalletLedger(accessToken),
        getUserRanking(accessToken),
        getMyAccessRequests(accessToken)
      ]);

      if (loadId !== latestLoadId.current) {
        return;
      }

      setWalletBalance(walletResult.wallet_balance);
      setContests(contestResult.contests);
      setWalletLedger(ledgerResult.ledger);
      setRanking(rankingResult.ranking);
      setAccessRequests(requestsResult.requests);
    } catch (loadError) {
      if (loadId !== latestLoadId.current) {
        return;
      }

      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
    } finally {
      if (loadId === latestLoadId.current) {
        setPageLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (!tenantSlug) {
      router.replace("/");
      return;
    }
  }, [isReady, router, tenantSlug]);

  useEffect(() => {
    if (!session?.accessToken || !tenantSlug) {
      return;
    }

    void loadData(session.accessToken);
  }, [session, tenantSlug]);

  if (!isReady) {
    return (
      <SiteShell title="Player Dashboard" subtitle="Loading local session...">
        <div className="notice">Checking saved session...</div>
      </SiteShell>
    );
  }

  if (!tenantSlug) {
    return (
      <SiteShell title="Player Dashboard" subtitle="Resolving organization workspace...">
        <div className="notice">Redirecting to organization selection...</div>
      </SiteShell>
    );
  }

  if (!session) {
    return (
      <SiteShell
        title="Player Dashboard"
        subtitle="Sign in with Google to use wallet, contests, and live gameplay."
      >
        <LoginCard tenantSlug={tenantSlug} targetHref={buildTenantPath(tenantSlug, "/dashboard")} />
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="Player Dashboard"
      subtitle="Manage your wallet, track the ledger, and move into live contests from a faster player control surface built for quick decisions."
    >
      <section className="spotlight-card" style={{ marginBottom: 20 }}>
        <div className="spotlight-grid">
          <div className="spotlight-copy">
            <div className="eyebrow">Player Control Surface</div>
            <h2 className="spotlight-title">Move from balance to contest room without losing momentum.</h2>
            <p className="muted hero-kicker">
              Keep wallet requests, quick contest lookup, and org ranking close together so the next action is always visible.
            </p>
            <div className="spotlight-actions">
              <button
                type="button"
                className="solid-button"
                onClick={() => {
                  setWalletModalMode("add");
                  setWalletActionForm((current) => ({
                    ...current,
                    amount: "50"
                  }));
                }}
              >
                Add Money
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setWalletModalMode("redeem");
                  setWalletActionForm((current) => ({
                    ...current,
                    amount: "50"
                  }));
                }}
              >
                Redeem
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setWalletLedgerOpen(true)}
              >
                History
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={pageLoading}
                onClick={() => {
                  void loadData(session.accessToken);
                }}
              >
                {pageLoading ? "Refreshing..." : "Refresh Dashboard"}
              </button>
            </div>
          </div>

          <div className="spotlight-stats">
            <div className="rail-card">
              <div className="rail-label">Wallet</div>
              <div className="rail-value">Rs {walletBalance}</div>
              <div className="rail-copy">Current balance available for contest joins and future payouts.</div>
            </div>
            <div className="rail-card">
              <div className="rail-label">Contest Window</div>
              <div className="rail-value">{contests.length} open now</div>
              <div className="rail-copy">Live-ready rooms with lobby tracking and leaderboard follow-through.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="signal-grid" style={{ marginBottom: 20 }}>
        <div className="signal-card">
          <div className="signal-label">Wallet Balance</div>
          <div className="signal-value">Rs {walletBalance}</div>
        </div>
        <div className="signal-card gold">
          <div className="signal-label">Open Contests</div>
          <div className="signal-value">{contests.length}</div>
        </div>
        <div className="signal-card rose">
          <div className="signal-label">Signed in as</div>
          <div className="signal-value">{session.name}</div>
        </div>
      </section>

      <div className="grid three">
        <div className="stat-card wallet-card">
          <div className="wallet-card-header">
            <div className="eyebrow">Wallet</div>
            <div className="stat-value">Rs {walletBalance}</div>
          </div>
        </div>

        <div className="card soft-card">
          <div className="eyebrow">Account</div>
          <h3>{session.name}</h3>
          <p className="muted mono">{session.email}</p>
          <div className="pill-row">
            <span className="pill">{session.isAdmin ? "Admin Access" : "Player Access"}</span>
            <span className="pill gold">{session.userType ?? "unassigned"}</span>
            <button
              type="button"
              className="ghost-button"
              disabled={pageLoading}
              onClick={() => {
                void loadData(session.accessToken);
              }}
            >
              {pageLoading ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>
          {session.userType === "employee" && !session.isAdmin ? (
            <div className="stack-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setMessage(null);
                  setError(null);
                  void (async () => {
                    try {
                      const result = await requestAdminAccess(session.accessToken);
                      setMessage(result.message);
                      await loadData(session.accessToken);
                    } catch (requestError) {
                      setError(requestError instanceof Error ? requestError.message : "Admin request failed");
                    }
                  })();
                }}
              >
                Request Admin Access
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setMessage(null);
                  setError(null);
                  void (async () => {
                    try {
                      const result = await requestExit(session.accessToken);
                      setMessage(result.message);
                      await loadData(session.accessToken);
                    } catch (requestError) {
                      setError(requestError instanceof Error ? requestError.message : "Exit request failed");
                    }
                  })();
                }}
              >
                Request Exit
              </button>
            </div>
          ) : null}
          {session.userType === "employee" && session.isAdmin ? (
            <div className="stack-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setMessage(null);
                  setError(null);
                  void (async () => {
                    try {
                      const result = await requestExit(session.accessToken);
                      setMessage(result.message);
                      await loadData(session.accessToken);
                    } catch (requestError) {
                      setError(requestError instanceof Error ? requestError.message : "Exit request failed");
                    }
                  })();
                }}
              >
                Request Exit
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 18 }}>
        <div className="card soft-card">
          <div className="eyebrow">Quick Open</div>
          <h3 style={{ marginTop: 16, marginBottom: 8 }}>Open by contest ID</h3>
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
              href={contestLookupId ? buildTenantPath(tenantSlug, `/contests/${contestLookupId}/live`) : buildTenantPath(tenantSlug, "/dashboard")}
              className="ghost-button"
            >
              Open Live Room
            </Link>
            <Link
              href={contestLookupId ? buildTenantPath(tenantSlug, `/contests/${contestLookupId}/leaderboard`) : buildTenantPath(tenantSlug, "/dashboard")}
              className="solid-button"
            >
              View Leaderboard
            </Link>
          </div>
        </div>

        <div className="card soft-card">
          <div className="eyebrow">Org Ranking</div>
          <h3 style={{ marginTop: 16, marginBottom: 8 }}>Top users in your organization</h3>
          <p className="muted" style={{ marginBottom: 14 }}>
            Ranked across your current organization workspace.
          </p>
          <div className="rank-list">
            {ranking.length === 0 ? (
              <div className="notice">No user ranking available yet.</div>
            ) : null}

            {ranking.map((entry) => (
              <div key={entry.user_id} className="rank-row">
                <div className="rank-index">{entry.rank}</div>
                <div className="rank-name">
                  <strong>{entry.name}</strong>
                  <div className="rank-subtitle">Organization leaderboard</div>
                </div>
                <span className="pill gold">Top {entry.rank}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {accessRequests.length > 0 ? (
        <div className="card soft-card" style={{ marginTop: 18 }}>
          <div className="eyebrow">My Requests</div>
          <div className="list" style={{ marginTop: 16 }}>
            {accessRequests.slice(0, 4).map((entry) => (
              <div key={entry.id} className="notice">
                <div className="stack-row spread">
                  <div>
                    <strong>{entry.request_type === "admin_access" ? "Admin access" : "Exit request"}</strong>
                    <div className="muted">{new Date(entry.created_at).toLocaleString()}</div>
                  </div>
                  <div className="pill-row">
                    <span className="pill">{entry.status}</span>
                    {entry.reviewed_at ? (
                      <span className="pill gold">Reviewed</span>
                    ) : null}
                  </div>
                </div>
                {entry.notes ? <div className="muted" style={{ marginTop: 8 }}>{entry.notes}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {message ? <div className="notice success" style={{ marginTop: 18 }}>{message}</div> : null}
      {error ? <div className="notice error" style={{ marginTop: 18 }}>{error}</div> : null}

      <section style={{ marginTop: 22 }}>
        <div className="section-head">
          <div className="section-head-copy">
            <div className="eyebrow">Open Contests</div>
            <h2 className="section-title">Join what is live next</h2>
          </div>
          <div className="pill-row">
            <span className="pill gold">Realtime lobby updates</span>
            <span className="pill">Wallet-safe join flow</span>
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
              <div className="stack-row spread">
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

                      void (async () => {
                        try {
                          const result = await joinContest(session.accessToken, contest.id);
                          setWalletBalance(result.wallet_balance);
                          setMessage(`Joined ${contest.title}. Prize pool is now Rs ${result.prize_pool}.`);
                          await loadData(session.accessToken);
                        } catch (joinError) {
                          setError(joinError instanceof Error ? joinError.message : "Join failed");
                        }
                      })();
                    }}
                  >
                    Join Contest
                  </button>

                  <Link href={buildTenantPath(tenantSlug, `/contests/${contest.id}/live`)} className="ghost-button">
                    Open Live View
                  </Link>
                </div>
              </div>

              <p className="muted" style={{ marginBottom: 0 }}>
                Starts at {new Date(contest.starts_at).toLocaleString()}
              </p>
            </article>
          ))}
        </div>
      </section>

      {walletModalMode ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            {walletActionPending ? (
              <div className="processing-overlay">
                <div className="processing-card">
                  <span className="spinner" aria-hidden="true" />
                  <strong>Sending add-money request</strong>
                  <span className="muted">
                    Please wait while the wallet action is completed.
                  </span>
                </div>
              </div>
            ) : null}

            <div className="stack-row spread">
              <div>
                <div className="eyebrow">{walletModalMode === "add" ? "Add Money" : "Redeem"}</div>
                <h3 style={{ marginTop: 14, marginBottom: 8 }}>
                  {walletModalMode === "add"
                    ? "Send an approval request to admin"
                    : "Send a redeem request for admin approval"}
                </h3>
              </div>
              <button
                type="button"
                className="ghost-button"
                disabled={walletActionPending}
                onClick={() => setWalletModalMode(null)}
              >
                Close
              </button>
            </div>

            <div className="grid two" style={{ marginTop: 16 }}>
              <label className="field">
                <span>Amount</span>
                <input
                  value={walletActionForm.amount}
                  disabled={walletActionPending}
                  onChange={(event) =>
                    setWalletActionForm((current) => ({ ...current, amount: event.target.value }))
                  }
                />
              </label>

            </div>

            <div className="stack-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="solid-button"
                disabled={walletActionPending}
                onClick={() => {
                  if (walletActionPending) {
                    return;
                  }

                  setMessage(null);
                  setError(null);

                  void (async () => {
                    try {
                      setWalletActionPending(true);
                      const amountValue = Number(walletActionForm.amount);

                      if (!amountValue || amountValue <= 0) {
                        throw new Error("Enter a valid amount.");
                      }

                      await wait(2000);
                      if (walletModalMode === "add") {
                        await requestAddMoney(session.accessToken, amountValue);
                        setMessage("Add-money request sent to admin.");
                      } else {
                        await requestRedeem(session.accessToken, amountValue);
                        setMessage("Redeem request sent to admin.");
                      }

                      await loadData(session.accessToken);
                      setWalletModalMode(null);
                    } catch (walletError) {
                      setError(walletError instanceof Error ? walletError.message : "Wallet action failed");
                    } finally {
                      setWalletActionPending(false);
                    }
                  })();
                }}
              >
                {walletActionPending
                  ? "Processing..."
                  : "Send Request"}
              </button>

              <button
                type="button"
                className="ghost-button"
                disabled={walletActionPending}
                onClick={() => setWalletModalMode(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {walletLedgerOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card ledger-modal">
            <div className="stack-row spread">
              <div>
                <div className="eyebrow">Wallet Ledger</div>
                <h3 style={{ marginTop: 14, marginBottom: 8 }}>Recent wallet history</h3>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setWalletLedgerOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="ledger-list" style={{ marginTop: 16 }}>
              {walletLedger.length === 0 ? (
                <div className="notice">No wallet entries yet.</div>
              ) : null}

              {walletLedger.map((entry) => (
                <div key={entry.id} className="ledger-row">
                  <div className="ledger-main">
                    <div className="stack-row spread">
                      <strong>{formatReason(entry.reason)}</strong>
                      <span className={entry.type === "credit" ? "ledger-amount credit" : "ledger-amount debit"}>
                        {entry.type === "credit" ? "+" : "-"}Rs {entry.amount}
                      </span>
                    </div>
                    <div className="muted ledger-copy">
                      Balance {entry.balance_before} to {entry.balance_after}
                    </div>
                  </div>
                  <div className="ledger-meta">
                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                    {entry.reference_id ? <span className="mono">{entry.reference_id}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </SiteShell>
  );
}
