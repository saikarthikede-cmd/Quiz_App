"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { LoginCard } from "../../components/login-card";
import { SiteShell } from "../../components/site-shell";
import { useFrontendSession } from "../../components/session-panel";
import {
  getOpenContests,
  getWalletBalance,
  getWalletLedger,
  joinContest,
  requestAddMoney,
  redeemMoney
} from "../../lib/api";

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

type WalletActionMode = "add" | "redeem";

interface WalletActionForm {
  amount: string;
  holderName: string;
  bankName: string;
  accountNumber: string;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatReason(reason: string) {
  switch (reason) {
    case "topup":
      return "Add Money";
    case "redeem":
      return "Redeem";
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
  const { session, isReady } = useFrontendSession();
  const [walletBalance, setWalletBalance] = useState<string>("0.00");
  const [walletLedger, setWalletLedger] = useState<WalletLedgerEntry[]>([]);
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
    amount: "50",
    holderName: "",
    bankName: "",
    accountNumber: ""
  });

  async function loadData(accessToken: string) {
    const loadId = ++latestLoadId.current;
    setPageLoading(true);
    setError(null);

    try {
      const [walletResult, contestResult, ledgerResult] = await Promise.all([
        getWalletBalance(accessToken),
        getOpenContests(),
        getWalletLedger(accessToken)
      ]);

      if (loadId !== latestLoadId.current) {
        return;
      }

      setWalletBalance(walletResult.wallet_balance);
      setContests(contestResult.contests);
      setWalletLedger(ledgerResult.ledger);
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
    if (!session?.accessToken) {
      return;
    }

    void loadData(session.accessToken);
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
      subtitle="Manage your wallet, track the ledger, and move into live contests with a cleaner player-ready control surface."
    >
      <section className="signal-grid" style={{ marginBottom: 20 }}>
        <div className="signal-card">
          <div className="signal-label">Wallet Signal</div>
          <div className="signal-value">Rs {walletBalance}</div>
          <div className="signal-subtitle">Available balance ready for entries, payouts, and manual local top-ups.</div>
        </div>
        <div className="signal-card gold">
          <div className="signal-label">Open Contests</div>
          <div className="signal-value">{contests.length}</div>
          <div className="signal-subtitle">Any contest with status open and remaining seats appears here automatically.</div>
        </div>
        <div className="signal-card rose">
          <div className="signal-label">Access Mode</div>
          <div className="signal-value">{session.isAdmin ? "Dual" : "Player"}</div>
          <div className="signal-subtitle">Signed in as {session.name}, with live-room shortcuts and persistent local session data.</div>
        </div>
      </section>

      <div className="grid three">
        <div className="stat-card wallet-card">
          <div className="wallet-card-header">
            <div className="eyebrow">Wallet</div>
            <div className="stat-value">Rs {walletBalance}</div>
          </div>
          <p className="muted">
            Production-style wallet entries are tracked with before/after balances so every change stays auditable.
          </p>
        </div>

        <div className="card accent-card">
          <div className="eyebrow">Wallet Actions</div>
          <h3 style={{ marginTop: 16, marginBottom: 8 }}>Add money or redeem in one guided flow</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Send an add-money request to admin or submit a redeem request with bank details. The wallet window stays in a clear processing state while each action completes.
          </p>
          <div className="stack-row" style={{ marginTop: 12 }}>
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
              className="solid-button"
              onClick={() => {
                setWalletModalMode("redeem");
                setWalletActionForm((current) => ({
                  ...current,
                  holderName: session.name,
                  amount: "25"
                }));
              }}
            >
              Redeem
            </button>
            <button
              type="button"
              className="icon-button icon-only"
              onClick={() => setWalletLedgerOpen(true)}
              aria-label="View recent wallet activity"
              title="Wallet history"
            >
              <span className="history-icon" aria-hidden="true">
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>

        <div className="card soft-card">
          <div className="eyebrow">Account</div>
          <h3>{session.name}</h3>
          <p className="muted mono">{session.email}</p>
          <div className="pill-row">
            <span className="pill">{session.isAdmin ? "Admin Access" : "Player Access"}</span>
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
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 18 }}>
        <div className="card soft-card">
          <div className="eyebrow">Quick Open</div>
          <h3 style={{ marginTop: 16, marginBottom: 8 }}>Jump by contest ID without losing momentum</h3>
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

        <div className="card accent-card">
          <div className="eyebrow">Player Runbook</div>
          <div className="command-list" style={{ marginTop: 16 }}>
            <div className="command-item">
              <strong>Top Up</strong>
              <span className="muted">Use the add-money window before joining if your wallet is low, then check the ledger to confirm the entry.</span>
            </div>
            <div className="command-item">
              <strong>Join</strong>
              <span className="muted">Entry is debited instantly and the live room receives lobby updates through sockets.</span>
            </div>
            <div className="command-item">
              <strong>Review</strong>
              <span className="muted">Paste any ended contest UUID above to open the leaderboard without going back to the terminal.</span>
            </div>
          </div>
        </div>
      </div>

      {message ? <div className="notice success" style={{ marginTop: 18 }}>{message}</div> : null}
      {error ? <div className="notice error" style={{ marginTop: 18 }}>{error}</div> : null}

      <section style={{ marginTop: 22 }}>
        <div className="stack-row spread">
          <div>
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

                  <Link href={`/contests/${contest.id}/live`} className="ghost-button">
                    Open Live View
                  </Link>
                </div>
              </div>

              <p className="muted" style={{ marginBottom: 0 }}>
                Starts at {new Date(contest.starts_at).toLocaleString()}
              </p>
              <div className="subtle-divider" />
              <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
                Prize pool expands automatically with each confirmed join, and the worker carries the room into live state at the scheduled time.
              </p>
              <div className="mono" style={{ marginTop: 10, fontSize: "0.84rem" }}>
                {contest.id}
              </div>
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
                  <strong>{walletModalMode === "add" ? "Sending add-money request" : "Processing redeem"}</strong>
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
                  {walletModalMode === "add" ? "Send an approval request to admin" : "Complete the redeem request"}
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

              {walletModalMode === "redeem" ? (
                <>
                  <label className="field">
                    <span>Holder Name</span>
                    <input
                      value={walletActionForm.holderName}
                      disabled={walletActionPending}
                      onChange={(event) =>
                        setWalletActionForm((current) => ({ ...current, holderName: event.target.value }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Bank Name</span>
                    <input
                      value={walletActionForm.bankName}
                      disabled={walletActionPending}
                      onChange={(event) =>
                        setWalletActionForm((current) => ({ ...current, bankName: event.target.value }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Bank Account Number</span>
                    <input
                      value={walletActionForm.accountNumber}
                      disabled={walletActionPending}
                      onChange={(event) =>
                        setWalletActionForm((current) => ({ ...current, accountNumber: event.target.value }))
                      }
                    />
                  </label>
                </>
              ) : null}
            </div>

            <div className="stack-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={walletModalMode === "add" ? "solid-button" : "rose-button"}
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
                        if (
                          !walletActionForm.holderName ||
                          !walletActionForm.bankName ||
                          !walletActionForm.accountNumber
                        ) {
                          throw new Error("Please fill all bank details.");
                        }

                        await redeemMoney(session.accessToken, {
                          amount: amountValue,
                          holder_name: walletActionForm.holderName,
                          bank_name: walletActionForm.bankName,
                          account_number: walletActionForm.accountNumber
                        });
                        setMessage("Redeem completed successfully.");
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
                  : walletModalMode === "add"
                    ? "Send Request"
                    : "Submit Redeem"}
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
