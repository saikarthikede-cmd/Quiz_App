"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";

import { LoginCard } from "../../components/login-card";
import { SiteShell } from "../../components/site-shell";
import { useFrontendSession } from "../../components/session-panel";
import {
  addQuestion,
  creditUserWallet,
  createContest,
  getAdminContests,
  getAdminUsers,
  getJobs,
  publishContest,
  rebuildContestCache,
  recoverContest,
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

export default function AdminPage() {
  const { session, isReady } = useFrontendSession();
  const [contests, setContests] = useState<AdminContest[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);

    try {
      const [contestResult, jobsResult, usersResult] = await Promise.all([
        getAdminContests(accessToken),
        getJobs(accessToken),
        getAdminUsers(accessToken)
      ]);

      setContests(contestResult.contests);
      setJobs(jobsResult.jobs);
      setUsers(usersResult.users);

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
      setError(loadError instanceof Error ? loadError.message : "Failed to load admin data");
    }
  }

  useEffect(() => {
    if (!session?.accessToken || !session.isAdmin) {
      return;
    }

    startTransition(() => {
      void loadAdminData(session.accessToken);
    });
  }, [session]);

  const selectedContest = useMemo(
    () => contests.find((contest) => contest.id === selectedContestId) ?? null,
    [contests, selectedContestId]
  );

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
          <span className="mono"> admin.quiz@gmail.com</span>.
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="Admin Console"
      subtitle="Create draft contests, attach questions, publish schedules, and watch queue state without touching the backend code directly."
    >
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error" style={{ marginTop: 14 }}>{error}</div> : null}

      <div className="grid two" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="eyebrow">Create Contest</div>
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

              startTransition(async () => {
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
              });
            }}
          >
            Create Contest
          </button>
        </div>

        <div className="card">
          <div className="eyebrow">Add Question</div>
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

                startTransition(async () => {
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
                });
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

                startTransition(async () => {
                  try {
                    await publishContest(session.accessToken, selectedContestId);
                    setMessage(`Published contest ${selectedContestId}`);
                    await loadAdminData(session.accessToken);
                  } catch (publishError) {
                    setError(publishError instanceof Error ? publishError.message : "Publish failed");
                  }
                });
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
          <div className="list" style={{ marginTop: 16 }}>
            {contests.map((contest) => (
              <div key={contest.id} className="contest-card">
                <div className="stack-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ margin: "0 0 8px" }}>{contest.title}</h3>
                    <div className="pill-row">
                      <span className="pill">{contest.status}</span>
                      <span className="pill gold">Prize Rs {contest.prize_pool}</span>
                      <span className="pill rose">{contest.member_count} joined</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setMessage(null);
                      setError(null);

                      startTransition(async () => {
                        try {
                          await recoverContest(session.accessToken, contest.id);
                          setMessage(`Recovery triggered for ${contest.id}`);
                          await loadAdminData(session.accessToken);
                        } catch (recoverError) {
                          setError(recoverError instanceof Error ? recoverError.message : "Recover failed");
                        }
                      });
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

                      startTransition(async () => {
                        try {
                          await rebuildContestCache(session.accessToken, contest.id);
                          setMessage(`Rebuilt cache for ${contest.id}`);
                          await loadAdminData(session.accessToken);
                        } catch (rebuildError) {
                          setError(rebuildError instanceof Error ? rebuildError.message : "Cache rebuild failed");
                        }
                      });
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

                <p className="muted" style={{ marginBottom: 0 }}>
                  Starts at {new Date(contest.starts_at).toLocaleString()}
                </p>
              </div>
            ))}
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

                      startTransition(async () => {
                        try {
                          const result = await retryJob(session.accessToken, job.queue, job.job_id);
                          setMessage(`Job action complete: ${result.mode}`);
                          await loadAdminData(session.accessToken);
                        } catch (retryError) {
                          setError(retryError instanceof Error ? retryError.message : "Job retry failed");
                        }
                      });
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
          <div className="eyebrow">Admin Wallet Credit</div>
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
            className="solid-button"
            disabled={!walletForm.userId}
            onClick={() => {
              if (!walletForm.userId) {
                setError("Select a user before crediting the wallet.");
                return;
              }

              setMessage(null);
              setError(null);

              startTransition(async () => {
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
              });
            }}
          >
            Credit Wallet
          </button>
        </div>

        <div className="card">
          <div className="eyebrow">Users</div>
          <div className="list" style={{ marginTop: 16 }}>
            {users.map((user) => (
              <div key={user.id} className="notice">
                <div className="stack-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
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
    </SiteShell>
  );
}
