"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { loginWithEmail } from "../lib/api";
import { setStoredSession } from "../lib/session";

const demoUsers = [
  { email: "player.one@gmail.com", name: "Player One" },
  { email: "player.two@gmail.com", name: "Player Two" },
  { email: "admin.quiz@gmail.com", name: "Quiz Admin" }
];

export function LoginCard({
  onSuccess,
  targetHref = "/dashboard"
}: {
  onSuccess?: () => void;
  targetHref?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("player.one@gmail.com");
  const [name, setName] = useState("Player One");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const result = await loginWithEmail(email, name);

        setStoredSession({
          accessToken: result.access_token,
          email: result.user.email,
          name: result.user.name,
          userId: result.user.id,
          isAdmin: result.user.is_admin
        });

        onSuccess?.();
        router.push(result.user.is_admin && targetHref === "/dashboard" ? "/admin" : targetHref);
        router.refresh();
      } catch (loginError) {
        setError(loginError instanceof Error ? loginError.message : "Login failed");
      }
    });
  }

  return (
    <div className="login-card">
      <div className="eyebrow">Temporary Email Auth</div>
      <h2 className="section-title" style={{ marginTop: 14 }}>
        Sign in to the local build
      </h2>
      <p className="muted">
        Google OAuth is intentionally swapped with email login until company credentials are
        available.
      </p>

      <form onSubmit={handleSubmit}>
        <label className="field">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <div className="stack-row" style={{ marginBottom: 16 }}>
          {demoUsers.map((user) => (
            <button
              key={user.email}
              type="button"
              className="ghost-button"
              onClick={() => {
                setEmail(user.email);
                setName(user.name);
              }}
            >
              {user.name}
            </button>
          ))}
        </div>

        <button type="submit" className="solid-button" disabled={isPending}>
          {isPending ? "Signing in..." : "Continue"}
        </button>
      </form>

      {error ? (
        <div className="notice error" style={{ marginTop: 14 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
