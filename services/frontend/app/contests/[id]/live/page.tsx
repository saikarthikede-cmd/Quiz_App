"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { LoginCard } from "../../../../components/login-card";
import { SiteShell } from "../../../../components/site-shell";
import { useFrontendSession } from "../../../../components/session-panel";
import { getOpenContests } from "../../../../lib/api";
import { GAME_URL } from "../../../../lib/config";

type Option = "a" | "b" | "c" | "d";

interface QuestionPayload {
  seq: number;
  body: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  time_limit_sec: number;
  server_time: number;
}

interface LeaderboardEntry {
  user_id: string;
  name: string;
  correct_count: number;
  is_winner: boolean;
  prize_amount: string;
}

export default function LiveContestPage() {
  const params = useParams<{ id: string }>();
  const contestId = params.id;
  const { session, isReady } = useFrontendSession();

  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState("Waiting for socket connection...");
  const [question, setQuestion] = useState<QuestionPayload | null>(null);
  const [selectedOption, setSelectedOption] = useState<Option | null>(null);
  const [answerResult, setAnswerResult] = useState<{ is_correct: boolean; your_score: number } | null>(null);
  const [reveal, setReveal] = useState<Option | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [revealCountdown, setRevealCountdown] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [prizeAmount, setPrizeAmount] = useState("0.00");
  const [youWon, setYouWon] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [contestStartsAtMs, setContestStartsAtMs] = useState<number | null>(null);
  const [waitingCountdown, setWaitingCountdown] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [isExamModalOpen, setIsExamModalOpen] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const answeredQuestionRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    const socket = io(GAME_URL, {
      transports: ["polling", "websocket"],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 10000,
      auth: {
        token: session.accessToken,
        contest_id: contestId
      }
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus(`Connected to contest ${contestId}`);
      setSocketError(null);
    });

    socket.on("connect_error", (error) => {
      setSocketError(error.message);
      setStatus("Socket connection failed");
    });

    socket.on("reconnected", (payload) => {
      setStatus(`Reconnected to live state on question ${payload.current_q}`);
      setTimeRemaining(payload.time_remaining ?? 0);
    });

    socket.on("lobby_update", (payload) => {
      setStatus(`Lobby update: ${payload.member_count} players, prize Rs ${payload.prize_pool}`);
    });

    socket.on("question", (payload: QuestionPayload) => {
      setQuestion(payload);
      setIsExamModalOpen(true);
      setShowSummaryModal(false);
      setSelectedOption(null);
      setAnswerResult(null);
      setReveal(null);
      setRevealCountdown(0);
      setWaitingCountdown(0);
      setStatus(`Question ${payload.seq} is live`);
    });

    socket.on("answer_result", (payload) => {
      setAnswerResult(payload);
      if (question && !answeredQuestionRef.current.has(question.seq)) {
        answeredQuestionRef.current.add(question.seq);
        setAnsweredCount(answeredQuestionRef.current.size);
      }
      setStatus(payload.is_correct ? "Answer recorded as correct" : "Answer recorded as wrong");
    });

    socket.on("reveal", (payload: { correct_option: Option }) => {
      setReveal(payload.correct_option);
      setRevealCountdown(3);
      setStatus(`Answer revealed for question ${question?.seq ?? payload.correct_option}`);
    });

    socket.on("contest_ended", (payload) => {
      setIsExamModalOpen(false);
      setLeaderboard(payload.leaderboard ?? []);
      setYouWon(Boolean(payload.you_won));
      setPrizeAmount(String(payload.prize_amount ?? "0.00"));
      setQuestion(null);
      setSelectedOption(null);
      setAnswerResult(null);
      setReveal(null);
      setRevealCountdown(0);
      setTimeRemaining(0);
      setShowSummaryModal(true);
      setStatus("Contest ended");
    });

    socket.on("error", (payload: { code?: string }) => {
      setSocketError(payload.code ?? "SERVER_ERROR");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [contestId, question, session?.accessToken]);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const result = await getOpenContests();
        if (!active) {
          return;
        }

        const contest = result.contests.find((item) => item.id === contestId);
        setContestStartsAtMs(contest ? new Date(contest.starts_at).getTime() : null);
      } catch {
        if (active) {
          setContestStartsAtMs(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [contestId, session?.accessToken]);

  useEffect(() => {
    if (!question) {
      setTimeRemaining(0);
      return;
    }

    const interval = window.setInterval(() => {
      const deadline = question.server_time + question.time_limit_sec * 1000;
      const nextValue = Math.max(0, deadline - Date.now());
      setTimeRemaining(nextValue);
    }, 200);

    return () => window.clearInterval(interval);
  }, [question]);

  useEffect(() => {
    if (revealCountdown <= 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setRevealCountdown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [revealCountdown]);

  useEffect(() => {
    const hasBlockingModal = isExamModalOpen || showSummaryModal;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    if (hasBlockingModal) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isExamModalOpen, showSummaryModal]);

  useEffect(() => {
    if (question || leaderboard.length > 0) {
      setWaitingCountdown(0);
      return;
    }

    const interval = window.setInterval(() => {
      if (revealCountdown > 0) {
        setWaitingCountdown(revealCountdown);
        return;
      }

      if (contestStartsAtMs) {
        setWaitingCountdown(Math.max(0, Math.ceil((contestStartsAtMs - Date.now()) / 1000)));
        return;
      }

      setWaitingCountdown(0);
    }, 250);

    return () => window.clearInterval(interval);
  }, [contestStartsAtMs, leaderboard.length, question, revealCountdown]);

  const options = useMemo(
    () =>
      question
        ? ([
            ["a", question.option_a],
            ["b", question.option_b],
            ["c", question.option_c],
            ["d", question.option_d]
          ] as const)
        : [],
    [question]
  );

  const yourFinalEntry = useMemo(
    () => leaderboard.find((entry) => entry.user_id === session?.userId) ?? null,
    [leaderboard, session?.userId]
  );

  const waitingLabel = revealCountdown > 0 ? "Next question arriving in" : "Time remaining";

  if (!isReady) {
    return (
      <SiteShell title="Live Contest" subtitle="Preparing local session...">
        <div className="notice">Loading session...</div>
      </SiteShell>
    );
  }

  if (!session) {
    return (
      <SiteShell
        title="Live Contest"
        subtitle="Sign in before joining a live contest room."
      >
        <LoginCard targetHref={`/contests/${contestId}/live`} />
      </SiteShell>
    );
  }

  return (
      <SiteShell
        title="Live Contest Room"
        subtitle="This room listens to the live Socket.io feed, tracks timing from server state, and stays visually focused while the contest advances."
      >
        <div className="room-grid">
          <div className="room-stage live-waiting-stage">
            <div className="eyebrow">Contest</div>
            <h2 className="section-title" style={{ marginTop: 16 }}>
              {leaderboard.length > 0 ? "Round complete" : "Waiting room"}
            </h2>
            <p className="muted">{status}</p>
            <div className="mono" style={{ marginTop: 14 }}>
              {contestId}
            </div>
            {socketError ? <div className="notice error">{socketError}</div> : null}

            {leaderboard.length === 0 ? (
              <div className="waiting-timer-panel">
                <div className="waiting-timer-label">{waitingLabel}</div>
                <div className="waiting-timer-value">
                  {question ? `${Math.ceil(timeRemaining / 1000)}s` : `${waitingCountdown}s`}
                </div>
                <div className="waiting-timer-copy">
                  {question
                    ? "The live question is already open in the exam window."
                    : "Stay here while the contest clock counts down. The exam window will open automatically."}
                </div>
              </div>
            ) : null}
          </div>

          <div className="card">
            <div className="eyebrow">Live Status</div>
            <div className="list" style={{ marginTop: 14 }}>
              <div className="notice">
                Answered questions: <span className="mono">{answeredCount}</span>
              </div>
              <div className="notice">
                Selected option: <span className="mono">{selectedOption ?? "-"}</span>
              </div>
              <div className="notice">
                Reveal countdown: <span className="mono">{revealCountdown}s</span>
              </div>
              <div className="notice">
                Prize if won: <span className="mono">Rs {prizeAmount}</span>
              </div>
            </div>
            <div className="hero-note muted">
              Correct answers are not shown as a running score during the exam. They are revealed only in the final summary after the contest ends.
            </div>
          </div>
        </div>

        {isExamModalOpen && question && !showSummaryModal && leaderboard.length === 0 ? (
          <div className="exam-overlay">
            <div className="exam-modal">
              <div className="exam-modal-topbar">
                <div className="exam-metric">
                  <span className="exam-metric-label">Question timer</span>
                  <strong>{Math.ceil(timeRemaining / 1000)}s</strong>
                </div>
                <div className="exam-metric">
                  <span className="exam-metric-label">Answered</span>
                  <strong>{answeredCount}</strong>
                </div>
                <div className="exam-metric">
                  <span className="exam-metric-label">Question</span>
                  <strong>{question.seq}</strong>
                </div>
              </div>

              <div className="exam-modal-body">
                <div className="eyebrow">Question {question.seq}</div>
                <h2 className="section-title" style={{ marginTop: 14 }}>
                  {question.body}
                </h2>
                <p className="muted">
                  Choose one option before the timer closes. If your answer has been submitted, the reveal state will still behave exactly as before.
                </p>

                {answerResult ? (
                  <div className={`notice ${answerResult.is_correct ? "success" : "warn"}`}>
                    {answerResult.is_correct
                      ? "Your answer is recorded. Final correct-count summary will appear after the contest ends."
                      : "Your answer is recorded. Final correct-count summary will appear after the contest ends."}
                  </div>
                ) : null}

                <div className="answer-grid" style={{ marginTop: 18 }}>
                  {options.map(([key, value]) => {
                    const isSelected = selectedOption === key;
                    const isCorrect = reveal === key;
                    const isWrongSelected = reveal !== null && isSelected && reveal !== key;

                    return (
                      <button
                        key={key}
                        type="button"
                        className={[
                          "answer-button",
                          isSelected ? "selected" : "",
                          isCorrect ? "correct" : "",
                          isWrongSelected ? "wrong" : ""
                        ].join(" ").trim()}
                        onClick={() => {
                          setSelectedOption(key);
                          setSocketError(null);
                          socketRef.current?.emit("submit_answer", {
                            contest_id: contestId,
                            question_seq: question.seq,
                            chosen_option: key
                          });
                        }}
                        disabled={timeRemaining <= 0 || reveal !== null}
                      >
                        <strong>{key.toUpperCase()}</strong>
                        <div style={{ marginTop: 10 }}>{value}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showSummaryModal && leaderboard.length > 0 ? (
          <div className="exam-overlay summary-overlay">
            <div className="exam-modal summary-modal">
              <div className="stack-row spread" style={{ padding: "20px 20px 0" }}>
                <div>
                  <div className="eyebrow">Contest Summary</div>
                  <h2 className="section-title" style={{ marginTop: 14 }}>
                    {youWon ? "You won this round." : "Round complete."}
                  </h2>
                  <p className="muted">Prize credited: Rs {prizeAmount}</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setShowSummaryModal(false)}
                >
                  Close
                </button>
              </div>

              <div className="exam-modal-body">
                <div className="list">
                  <div className="notice">
                    Questions answered: <span className="mono">{answeredCount}</span>
                  </div>
                  <div className="notice">
                    Total correct: <span className="mono">{yourFinalEntry?.correct_count ?? "0"}</span>
                  </div>
                  <div className="notice">
                    Summary: <span className="mono">{youWon ? "Winner" : "Completed"}</span>
                  </div>
                </div>

                <div className="leaderboard-grid" style={{ marginTop: 18 }}>
                  {leaderboard.map((entry, index) => (
                    <div key={entry.user_id} className="contest-card leaderboard-row">
                      <div className={`rank-badge ${index === 0 ? "gold" : ""}`}>#{index + 1}</div>
                      <div>
                        <strong>{entry.name}</strong>
                        <div className="pill-row" style={{ marginTop: 8 }}>
                          <span className="pill">Correct {entry.correct_count}</span>
                          {entry.is_winner ? <span className="pill gold">Winner</span> : null}
                        </div>
                      </div>
                      <div className="pill rose">Prize Rs {entry.prize_amount}</div>
                    </div>
                  ))}
                </div>

                <div className="stack-row" style={{ marginTop: 16 }}>
                  <Link href={`/contests/${contestId}/leaderboard`} className="solid-button">
                    Open Leaderboard Page
                  </Link>
                  <Link href="/dashboard" className="ghost-button">
                    Back to Dashboard
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </SiteShell>
  );
}
