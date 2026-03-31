"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { LoginCard } from "../../components/login-card";
import { SiteShell } from "../../components/site-shell";
import { useFrontendSession } from "../../components/session-panel";
import {
  addQuestion,
  creditUserWallet,
  createContest,
  getAdminContests,
  getAdminUsers,
  getAdminWalletRequests,
  getJobs,
  publishContest,
  rebuildContestCache,
  recoverContest,
  reviewWalletRequest,
  retryJob
} from "../../lib/api";

interface AdminContest {
  id: string;
  title: string;
  status: string;
  member_count: number;
  starts_at: string;
  prize_pool: string;
}

interface JobItem {
  job_id: string;
  queue: string;
  job_name: string;
  data?: Record<string, unknown>;
  status: string;
  attempts?: number;
  scheduled_for: string;
  failed_reason: string | null;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  wallet_balance: string;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string;
}

interface WalletRequestItem {
  id: string;
  user_id: string;
  amount: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  user_name: string;
  user_email: string;
}

export default function AdminPage() {
  const { session, isReady } = useFrontendSession();
  const [contests, setContests] = useState<AdminContest[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [walletRequests, setWalletRequests] = useState<WalletRequestItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllContests, setShowAllContests] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const latestLoadId = useRef(0);

  const [contestForm, setContestForm] = useState({
    title: "Showcase Sprint",
    starts_at: new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 16),
    entry_fee: "10",
    max_members: "100",
    prize_rule: "all_correct" as "all_correct" | "top_scorer"
  });

  const [selectedContestId, setSelectedContestId] = useState("");
  const [questionForm, setQuestionForm] = useState({
    seq: "1",
    body: "Capital of India?",
    option_a: "Mumbai",
    option_b: "New Delhi",
    option_c: "Chennai",
    option_d: "Kolkata",
    correct_option: "b" as "a" | "b" | "c" | "d",
    time_limit_sec: "15"
  });
  const [walletForm, setWalletForm] = useState({
    userId: "",
    amount: "50"
  });

  async function loadAdminData(accessToken: string) {
    const loadId = ++latestLoadId.current;
    setPageLoading(true);
    setError(null);

    try {
      const [contestResult, jobsResult, usersResult, walletRequestsResult] = await Promise.all([
        getAdminContests(accessToken),
        getJobs(accessToken),
        getAdminUsers(accessToken),
        getAdminWalletRequests(accessToken)
      ]);

      if (loadId !== latestLoadId.current) {
        return;
      }

      setContests(contestResult.contests);
      setJobs(jobsResult.jobs);
      setUsers(usersResult.users);
      setWalletRequests(walletRequestsResult.requests);

      if (!selectedContestId && contestResult.contests.length > 0) {
        setSelectedContestId(contestResult.contests[0].id);
      }

      if (!walletForm.userId && usersResult.users.length > 0) {
        const firstNonAdmin = usersResult.users.find((user) => !user.is_admin) ?? usersResult.users[0];
        setWalletForm((current) => ({
          ...current,
          userId: firstNonAdmin.id
        }));
      }
    } catch (loadError) {
      if (loadId !== latestLoadId.current) {
        return;
      }

      setError(loadError instanceof Error ? loadError.message : "Failed to load admin data");
    } finally {
      if (loadId === latestLoadId.current) {
        setPageLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!session?.accessToken || !session.isAdmin) {
      return;
    }

    void loadAdminData(session.accessToken);
  }, [session]);

  const selectedContest = useMemo(
    () => contests.find((contest) => contest.id === selectedContestId) ?? null,
    [contests, selectedContestId]
  );
  const activeJobs = jobs.filter((job) => job.status !== "failed").length;
  const pendingWalletRequests = walletRequests.filter((request) => request.status === "pending").length;
  const visibleContests = contests.slice(0, 3);

  if (!isReady) {
    return (
      <SiteShell title="Admin Console" subtitle="Loading admin session...">
        <div className="notice">Checking saved session...</div>
      </SiteShell>
    );
  }

  if (!session) {
    return (
      <SiteShell
        title="Admin Console"
        subtitle="Sign in as the local admin account to create contests, publish jobs, and inspect queue state."
      >
        <LoginCard targetHref="/admin" />
      </SiteShell>
    );
  }

  if (!session.isAdmin) {
    return (
      <SiteShell title="Admin Console" subtitle="This route is reserved for admin users.">
        <div className="notice error">
          The current session does not have admin access. Sign in using
          <span className="mono"> saikarthik.ede@fissionlabs.com</span>.
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="Admin Console"
      subtitle="Create draft contests, attach questions, publish schedules, and monitor queue, cache, and payout paths from one brighter ops-ready control surface."
    >
      {pageLoading ? <div className="notice">Refreshing admin data...</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error" style={{ marginTop: 14 }}>{error}</div> : null}

      <section className="signal-grid" style={{ marginTop: 20 }}>
        <div className="signal-card">
          <div className="signal-label">Total Contests</div>
          <div className="signal-value">{contests.length}</div>
          <div className="signal-subtitle">Draft, open, live, ended, and cancelled contests tracked through one admin view.</div>
        </div>
        <div className="signal-card gold">
          <div className="signal-label">Queue Activity</div>
          <div className="signal-value">{activeJobs}</div>
          <div className="signal-subtitle">Jobs currently active, delayed, or waiting across lifecycle and payouts queues.</div>
        </div>
        <div className="signal-card rose">
          <div className="signal-label">Wallet Requests</div>
          <div className="signal-value">{pendingWalletRequests}</div>
          <div className="signal-subtitle">Pending top-up requests waiting for admin approval before balances are credited.</div>
        </div>
      </section>

      <div className="grid two" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="eyebrow">Create Contest</div>
          <h3 style={{ marginTop: 16, marginBottom: 10 }}>Spin up a new room with production-style scheduling rules</h3>
          <label className="field">
            <span>Title</span>
            <input
              value={contestForm.title}
              onChange={(event) => setContestForm((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Starts At</span>
            <input
              type="datetime-local"
              value={contestForm.starts_at}
              onChange={(event) => setContestForm((current) => ({ ...current, starts_at: event.target.value }))}
            />
          </label>
          <div className="grid two">
            <label className="field">
              <span>Entry Fee</span>
              <input
                value={contestForm.entry_fee}
                onChange={(event) => setContestForm((current) => ({ ...current, entry_fee: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Max Members</span>
              <input
                value={contestForm.max_members}
                onChange={(event) => setContestForm((current) => ({ ...current, max_members: event.target.value }))}
              />
            </label>
          </div>
          <label className="field">
            <span>Prize Rule</span>
            <select
              value={contestForm.prize_rule}
              onChange={(event) =>
                setContestForm((current) => ({
                  ...current,
                  prize_rule: event.target.value as "all_correct" | "top_scorer"
                }))
              }
            >
              <option value="all_correct">all_correct</option>
              <option value="top_scorer">top_scorer</option>
            </select>
          </label>
          <button
            type="button"
            className="solid-button"
            onClick={() => {
              setMessage(null);
              setError(null);

              void (async () => {
                try {
                  const result = await createContest(session.accessToken, {
                    title: contestForm.title,
                    starts_at: new Date(contestForm.starts_at).toISOString(),
                    entry_fee: Number(contestForm.entry_fee),
                    max_members: Number(contestForm.max_members),
                    prize_rule: contestForm.prize_rule
                  });

                  setSelectedContestId(result.contest.id);
                  setMessage(`Created contest ${result.contest.id}`);
                  await loadAdminData(session.accessToken);
                } catch (createError) {
                  setError(createError instanceof Error ? createError.message : "Contest creation failed");
                }
              })();
            }}
          >
            Create Contest
          </button>
        </div>

        <div className="card">
          <div className="eyebrow">Add Question</div>
          <h3 style={{ marginTop: 16, marginBottom: 10 }}>Build the sequence, then publish from the same panel</h3>
          <label className="field">
            <span>Contest</span>
            <select
              value={selectedContestId}
              onChange={(event) => setSelectedContestId(event.target.value)}
            >
              <option value="">Select contest</option>
              {contests.map((contest) => (
                <option key={contest.id} value={contest.id}>
                  {contest.title} ({contest.status})
                </option>
              ))}
            </select>
          </label>
          <div className="grid two">
            <label className="field">
              <span>Sequence</span>
              <input
                value={questionForm.seq}
                onChange={(event) => setQuestionForm((current) => ({ ...current, seq: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Time Limit</span>
              <input
                value={questionForm.time_limit_sec}
                onChange={(event) =>
                  setQuestionForm((current) => ({ ...current, time_limit_sec: event.target.value }))
                }
              />
            </label>
          </div>
          <label className="field">
            <span>Question</span>
            <textarea
              value={questionForm.body}
              onChange={(event) => setQuestionForm((current) => ({ ...current, body: event.target.value }))}
            />
          </label>
          <div className="grid two">
            <label className="field">
              <span>Option A</span>
              <input
                value={questionForm.option_a}
                onChange={(event) => setQuestionForm((current) => ({ ...current, option_a: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Option B</span>
              <input
                value={questionForm.option_b}
                onChange={(event) => setQuestionForm((current) => ({ ...current, option_b: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Option C</span>
              <input
                value={questionForm.option_c}
                onChange={(event) => setQuestionForm((current) => ({ ...current, option_c: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Option D</span>
              <input
                value={questionForm.option_d}
                onChange={(event) => setQuestionForm((current) => ({ ...current, option_d: event.target.value }))}
              />
            </label>
          </div>
          <label className="field">
            <span>Correct Option</span>
            <select
              value={questionForm.correct_option}
              onChange={(event) =>
                setQuestionForm((current) => ({
                  ...current,
                  correct_option: event.target.value as "a" | "b" | "c" | "d"
                }))
              }
            >
              <option value="a">a</option>
              <option value="b">b</option>
              <option value="c">c</option>
              <option value="d">d</option>
            </select>
          </label>
          <div className="stack-row">
            <button
              type="button"
              className="solid-button"
              disabled={!selectedContestId}
              onClick={() => {
                if (!selectedContestId) {
                  setError("Select a contest first.");
                  return;
                }

                setMessage(null);
                setError(null);

                void (async () => {
                  try {
                    const result = await addQuestion(session.accessToken, selectedContestId, {
                      seq: Number(questionForm.seq),
                      body: questionForm.body,
                      option_a: questionForm.option_a,
                      option_b: questionForm.option_b,
                      option_c: questionForm.option_c,
                      option_d: questionForm.option_d,
                      correct_option: questionForm.correct_option,
                      time_limit_sec: Number(questionForm.time_limit_sec)
                    });

                    setMessage(`Added question ${result.question.seq} to ${selectedContestId}`);
                    setQuestionForm((current) => ({
                      ...current,
                      seq: String(Number(current.seq) + 1)
                    }));
                    await loadAdminData(session.accessToken);
                  } catch (questionError) {
                    setError(questionError instanceof Error ? questionError.message : "Question add failed");
                  }
                })();
              }}
            >
              Add Question
            </button>

            <button
              type="button"
              className="ghost-button"
              disabled={!selectedContestId}
              onClick={() => {
                if (!selectedContestId) {
                  return;
                }

                setMessage(null);
                setError(null);

                void (async () => {
                  try {
                    await publishContest(session.accessToken, selectedContestId);
                    setMessage(`Published contest ${selectedContestId}`);
                    await loadAdminData(session.accessToken);
                  } catch (publishError) {
                    setError(publishError instanceof Error ? publishError.message : "Publish failed");
                  }
                })();
              }}
            >
              Publish Selected Contest
            </button>
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 22 }}>
        <div className="card">
          <div className="eyebrow">Contest Monitor</div>
          <div className="hero-note muted">
            Recovery and cache rebuild stay visible here, while the full contest archive opens only when you ask for it.
          </div>
          <div className="list" style={{ marginTop: 16 }}>
            {visibleContests.map((contest) => (
              <div key={contest.id} className="contest-card">
                <div className="stack-row spread">
                  <div>
                    <h3 style={{ margin: "0 0 8px" }}>{contest.title}</h3>
                    <div className="pill-row">
                      <span className="pill">{contest.status}</span>
                      <span className="pill gold">Prize Rs {contest.prize_pool}</span>
                      <span className="pill rose">{contest.member_count} joined</span>
                    </div>
                  </div>
                  <div className="stack-row">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setMessage(null);
                        setError(null);

                        void (async () => {
                          try {
                            await recoverContest(session.accessToken, contest.id);
                            setMessage(`Recovery triggered for ${contest.id}`);
                            await loadAdminData(session.accessToken);
                          } catch (recoverError) {
                            setError(recoverError instanceof Error ? recoverError.message : "Recover failed");
                          }
                        })();
                      }}
                    >
                      Recover
                    </button>

                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setMessage(null);
                        setError(null);

                        void (async () => {
                          try {
                            await rebuildContestCache(session.accessToken, contest.id);
                            setMessage(`Rebuilt cache for ${contest.id}`);
                            await loadAdminData(session.accessToken);
                          } catch (rebuildError) {
                            setError(rebuildError instanceof Error ? rebuildError.message : "Cache rebuild failed");
                          }
                        })();
                      }}
                    >
                      Rebuild Cache
                    </button>

                    {contest.status === "ended" ? (
                      <Link href={`/contests/${contest.id}/leaderboard`} className="solid-button">
                        View Result
                      </Link>
                    ) : null}
                  </div>
                </div>

                <p className="muted" style={{ marginBottom: 0 }}>
                  Starts at {new Date(contest.starts_at).toLocaleString()}
                </p>
              </div>
            ))}
            {contests.length > visibleContests.length ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowAllContests(true)}
              >
                Show More Contests
              </button>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="eyebrow">Job Monitor</div>
          <div className="list" style={{ marginTop: 16 }}>
            {jobs.length === 0 ? <div className="notice warn">No queued jobs right now.</div> : null}
            {jobs.map((job) => (
              <div key={job.job_id} className="notice">
                <div className="pill-row" style={{ marginBottom: 10 }}>
                  <span className="pill">{job.queue}</span>
                  <span className="pill gold">{job.job_name}</span>
                  <span className="pill rose">{job.status}</span>
                </div>
                <div className="mono" style={{ marginBottom: 8 }}>
                  {job.job_id}
                </div>
                <div className="muted">Scheduled for {new Date(job.scheduled_for).toLocaleString()}</div>
                <div className="muted">Attempts made: {job.attempts ?? 0}</div>
                <div className="mono" style={{ marginTop: 8, fontSize: "0.86rem" }}>
                  {JSON.stringify(job.data ?? {})}
                </div>
                {job.failed_reason ? (
                  <div className="notice error" style={{ marginTop: 10 }}>
                    {job.failed_reason}
                  </div>
                ) : null}
                <div className="stack-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setMessage(null);
                      setError(null);

                      void (async () => {
                        try {
                          const result = await retryJob(session.accessToken, job.queue, job.job_id);
                          setMessage(`Job action complete: ${result.mode}`);
                          await loadAdminData(session.accessToken);
                        } catch (retryError) {
                          setError(retryError instanceof Error ? retryError.message : "Job retry failed");
                        }
                      })();
                    }}
                  >
                    Retry / Recreate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 22 }}>
        <div className="card">
          <div className="eyebrow">Manage Wallets</div>
          <h3 style={{ marginTop: 16, marginBottom: 10 }}>Approve add-money requests before balances change</h3>
          <div className="list" style={{ marginTop: 16 }}>
            {walletRequests.length === 0 ? (
              <div className="notice warn">No wallet requests yet.</div>
            ) : null}

            {walletRequests.slice(0, 6).map((walletRequest) => (
              <div key={walletRequest.id} className="notice">
                <div className="stack-row spread">
                  <div>
                    <strong>{walletRequest.user_name}</strong>
                    <div className="muted">{walletRequest.user_email}</div>
                  </div>
                  <div className="pill-row">
                    <span className="pill gold">Rs {walletRequest.amount}</span>
                    <span className="pill">{walletRequest.status}</span>
                  </div>
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  Requested at {new Date(walletRequest.created_at).toLocaleString()}
                </div>
                {walletRequest.status === "pending" ? (
                  <div className="stack-row" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="solid-button"
                      onClick={() => {
                        setMessage(null);
                        setError(null);

                        void (async () => {
                          try {
                            const result = await reviewWalletRequest(
                              session.accessToken,
                              walletRequest.id,
                              "approved"
                            );
                            setMessage(
                              `Approved request for ${result.user_name}. Wallet is now Rs ${result.wallet_balance}.`
                            );
                            await loadAdminData(session.accessToken);
                          } catch (reviewError) {
                            setError(reviewError instanceof Error ? reviewError.message : "Approval failed");
                          }
                        })();
                      }}
                    >
                      Accept Request
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setMessage(null);
                        setError(null);

                        void (async () => {
                          try {
                            const result = await reviewWalletRequest(
                              session.accessToken,
                              walletRequest.id,
                              "rejected"
                            );
                            setMessage(`Rejected request for ${result.user_name}.`);
                            await loadAdminData(session.accessToken);
                          } catch (reviewError) {
                            setError(reviewError instanceof Error ? reviewError.message : "Rejection failed");
                          }
                        })();
                      }}
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="subtle-divider" />

          <h3 style={{ marginTop: 8, marginBottom: 10 }}>Manual credit fallback</h3>
          <label className="field">
            <span>User</span>
            <select
              value={walletForm.userId}
              onChange={(event) => setWalletForm((current) => ({ ...current, userId: event.target.value }))}
            >
              <option value="">Select user</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} | {user.email} | Rs {user.wallet_balance}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Amount</span>
            <input
              value={walletForm.amount}
              onChange={(event) => setWalletForm((current) => ({ ...current, amount: event.target.value }))}
            />
          </label>
          <button
            type="button"
            className="ghost-button"
            disabled={!walletForm.userId}
            onClick={() => {
              if (!walletForm.userId) {
                setError("Select a user before crediting the wallet.");
                return;
              }

              setMessage(null);
              setError(null);

              void (async () => {
                try {
                  const result = await creditUserWallet(
                    session.accessToken,
                    walletForm.userId,
                    Number(walletForm.amount)
                  );
                  setMessage(`Wallet credited. New balance Rs ${result.wallet_balance}`);
                  await loadAdminData(session.accessToken);
                } catch (creditError) {
                  setError(creditError instanceof Error ? creditError.message : "Wallet credit failed");
                }
              })();
            }}
          >
            Credit Wallet Directly
          </button>
        </div>

        <div className="card">
          <div className="eyebrow">Users</div>
          <div className="hero-note muted">
            Quick visibility into wallet state, admin access, and account flags while you test contest flows.
          </div>
          <div className="list" style={{ marginTop: 16 }}>
            {users.map((user) => (
              <div key={user.id} className="notice">
                <div className="stack-row spread">
                  <div>
                    <strong>{user.name}</strong>
                    <div className="muted">{user.email}</div>
                  </div>
                  <div className="pill-row">
                    <span className="pill gold">Rs {user.wallet_balance}</span>
                    {user.is_admin ? <span className="pill">Admin</span> : null}
                    {user.is_banned ? <span className="pill rose">Banned</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedContest ? (
        <div className="footer-note">
          Selected contest for question entry: <span className="mono">{selectedContest.id}</span>
        </div>
      ) : null}

      {showAllContests ? (
        <div className="modal-backdrop">
          <div className="modal-card ledger-modal">
            <div className="stack-row spread">
              <div>
                <div className="eyebrow">All Contests</div>
                <h3 style={{ marginTop: 14, marginBottom: 8 }}>Full contest archive</h3>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowAllContests(false)}
              >
                Close
              </button>
            </div>

            <div className="list" style={{ marginTop: 16 }}>
              {contests.map((contest) => (
                <div key={contest.id} className="contest-card">
                  <div className="stack-row spread">
                    <div>
                      <h3 style={{ margin: "0 0 8px" }}>{contest.title}</h3>
                      <div className="pill-row">
                        <span className="pill">{contest.status}</span>
                        <span className="pill gold">Prize Rs {contest.prize_pool}</span>
                        <span className="pill rose">{contest.member_count} joined</span>
                      </div>
                    </div>
                    {contest.status === "ended" ? (
                      <Link href={`/contests/${contest.id}/leaderboard`} className="solid-button">
                        View Result
                      </Link>
                    ) : null}
                  </div>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Starts at {new Date(contest.starts_at).toLocaleString()}
                  </p>
                  <div className="mono" style={{ marginTop: 10, fontSize: "0.84rem" }}>
                    {contest.id}
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
