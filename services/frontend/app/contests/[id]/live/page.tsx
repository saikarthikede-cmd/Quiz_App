"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { LoginCard } from "../../../../components/login-card";
import { SiteShell } from "../../../../components/site-shell";
import { useFrontendSession } from "../../../../components/session-panel";
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

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    const socket = io(GAME_URL, {
      transports: ["websocket"],
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
      setSelectedOption(null);
      setAnswerResult(null);
      setReveal(null);
      setRevealCountdown(0);
      setStatus(`Question ${payload.seq} is live`);
    });

    socket.on("answer_result", (payload) => {
      setAnswerResult(payload);
      setStatus(payload.is_correct ? "Answer recorded as correct" : "Answer recorded as wrong");
    });

    socket.on("reveal", (payload: { correct_option: Option }) => {
      setReveal(payload.correct_option);
      setRevealCountdown(3);
      setStatus(`Answer revealed for question ${question?.seq ?? payload.correct_option}`);
    });

    socket.on("contest_ended", (payload) => {
      setLeaderboard(payload.leaderboard ?? []);
      setYouWon(Boolean(payload.you_won));
      setPrizeAmount(String(payload.prize_amount ?? "0.00"));
      setStatus("Contest ended");
    });

    socket.on("error", (payload: { code?: string }) => {
      setSocketError(payload.code ?? "SERVER_ERROR");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
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
        <div className="room-stage">
          <div className="eyebrow">Contest</div>
          <h2 className="section-title" style={{ marginTop: 16 }}>
            {question ? `Question ${question.seq} is on air` : "Stand by for the next broadcast"}
          </h2>
          <p className="muted">{status}</p>
          <div className="mono" style={{ marginTop: 14 }}>
            {contestId}
          </div>
          {socketError ? <div className="notice error">{socketError}</div> : null}
          <div className="signal-grid" style={{ marginTop: 18 }}>
            <div className="signal-card">
              <div className="signal-label">Timer</div>
              <div className="signal-value">{Math.ceil(timeRemaining / 1000)}s</div>
              <div className="signal-subtitle">Synced to server_time from the question payload.</div>
            </div>
            <div className="signal-card gold">
              <div className="signal-label">Score</div>
              <div className="signal-value">{answerResult?.your_score ?? 0}</div>
              <div className="signal-subtitle">Updated after the answer_result event returns from the game server.</div>
            </div>
            <div className="signal-card rose">
              <div className="signal-label">Reveal Gap</div>
              <div className="signal-value">{revealCountdown}s</div>
              <div className="signal-subtitle">Local three-second countdown before the next live question lands.</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="eyebrow">Result State</div>
          <div className="list" style={{ marginTop: 14 }}>
            <div className="notice">
              Selected option: <span className="mono">{selectedOption ?? "-"}</span>
            </div>
            <div className="notice">
              Revealed option: <span className="mono">{reveal ?? "-"}</span>
            </div>
            <div className="notice">
              Post-reveal countdown: <span className="mono">{revealCountdown}s</span>
            </div>
            <div className="notice">
              Prize if won: <span className="mono">Rs {prizeAmount}</span>
            </div>
          </div>
          <div className="hero-note muted">
            A correct answer is only confirmed privately to this player. The actual correct option is revealed to everyone together after the timer closes.
          </div>
        </div>
      </div>

      {question ? (
        <div className="live-board" style={{ marginTop: 24 }}>
          <div className="card">
            <div className="eyebrow">Question {question.seq}</div>
            <h2 className="section-title" style={{ marginTop: 14 }}>
              {question.body}
            </h2>

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
      ) : (
        <div className="notice warn" style={{ marginTop: 24 }}>
          Waiting for the worker to broadcast the next live question. Open this page a little before
          contest start time.
        </div>
      )}

      {leaderboard.length > 0 ? (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="eyebrow">Contest Finished</div>
          <h2 className="section-title" style={{ marginTop: 14 }}>
            {youWon ? "You won this round." : "Round complete."}
          </h2>
          <p className="muted">Prize credited: Rs {prizeAmount}</p>
          <div className="leaderboard-grid">
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
      ) : null}
    </SiteShell>
  );
}
