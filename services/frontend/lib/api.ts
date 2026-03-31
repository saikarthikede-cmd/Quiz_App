import { clearStoredSession, getStoredSession, setStoredSession } from "./session";
import { API_URL } from "./config";

export interface LoginResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    name: string;
    wallet_balance: string;
    is_admin: boolean;
  };
}

export interface OtpRequestResponse {
  success: boolean;
  mode: string;
  delivery: string;
  expires_in_seconds: number;
  comment: string;
  dev_otp?: string;
}

export interface GoogleConfigResponse {
  enabled: boolean;
  client_id: string | null;
}

let refreshPromise: Promise<string | null> | null = null;

async function runFetch(path: string, init?: RequestInit, accessToken?: string) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {})
    },
    credentials: "include",
    cache: "no-store"
  });
}

async function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const response = await runFetch("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({})
      });

      if (!response.ok) {
        clearStoredSession();
        return null;
      }

      const body = (await response.json()) as { access_token: string };
      const existingSession = getStoredSession();

      if (existingSession) {
        setStoredSession({
          ...existingSession,
          accessToken: body.access_token
        });
      }

      return body.access_token;
    } catch {
      clearStoredSession();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function apiFetch<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  let response = await runFetch(path, init, accessToken);

  const canRetryWithRefresh =
    response.status === 401 &&
    Boolean(accessToken) &&
    !path.startsWith("/auth/refresh") &&
    !path.startsWith("/auth/google") &&
    !path.startsWith("/auth/request-otp") &&
    !path.startsWith("/auth/verify-otp") &&
    !path.startsWith("/auth/dev-login");

  if (canRetryWithRefresh) {
    const nextAccessToken = await refreshAccessToken();

    if (nextAccessToken) {
      response = await runFetch(path, init, nextAccessToken);
    }
  }

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;

    try {
      const errorBody = (await response.json()) as { message?: string };
      if (errorBody.message) {
        message = errorBody.message;
      }
    } catch {
      // Ignore parse errors.
    }

    if (
      response.status === 401 ||
      message === "User not found" ||
      message === "Invalid or expired access token" ||
      message === "Missing refresh token cookie" ||
      message === "Refresh token is invalid or expired"
    ) {
      clearStoredSession();
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function loginWithEmail(email: string, name: string) {
  return apiFetch<LoginResponse>("/auth/dev-login", {
    method: "POST",
    body: JSON.stringify({ email, name })
  });
}

export function getGoogleConfig() {
  return apiFetch<GoogleConfigResponse>("/auth/google/config");
}

export function loginWithGoogle(idToken: string) {
  return apiFetch<LoginResponse>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken })
  });
}

export function requestOtp(email: string, name: string) {
  return apiFetch<OtpRequestResponse>("/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ email, name })
  });
}

export function verifyOtp(email: string, otp: string) {
  return apiFetch<LoginResponse>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, otp })
  });
}

export function getWalletBalance(accessToken: string) {
  return apiFetch<{ wallet_balance: string }>("/wallet/balance", undefined, accessToken);
}

export function getWalletLedger(accessToken: string) {
  return apiFetch<{
    ledger: Array<{
      id: string;
      type: "credit" | "debit";
      reason: string;
      amount: string;
      balance_before: string;
      balance_after: string;
      reference_id: string | null;
      metadata?: Record<string, unknown> | null;
      created_at: string;
    }>;
  }>("/wallet/ledger", undefined, accessToken);
}

export function requestAddMoney(accessToken: string, amount: number) {
  return apiFetch<{
    success: boolean;
    message: string;
    request: {
      id: string;
      amount: string;
      status: "pending";
      created_at: string;
    };
  }>(
    "/wallet/add-money",
    {
      method: "POST",
      body: JSON.stringify({ amount })
    },
    accessToken
  );
}

export function redeemMoney(
  accessToken: string,
  payload: {
    amount: number;
    holder_name: string;
    bank_name: string;
    account_number: string;
  }
) {
  return apiFetch<{ success: boolean; wallet_balance: string }>(
    "/wallet/redeem",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );
}

export function getOpenContests() {
  return apiFetch<{
    contests: Array<{
      id: string;
      title: string;
      entry_fee: string;
      max_members: number;
      member_count: number;
      starts_at: string;
      prize_pool: string;
    }>;
  }>("/contests");
}

export function joinContest(accessToken: string, contestId: string) {
  return apiFetch<{
    success: boolean;
    contest_id: string;
    member_count: number;
    prize_pool: string;
    wallet_balance: string;
  }>(
    `/contests/${contestId}/join`,
    {
      method: "POST",
      body: JSON.stringify({})
    },
    accessToken
  );
}

export function getLeaderboard(contestId: string) {
  return apiFetch<{
    leaderboard: Array<{
      user_id: string;
      name: string;
      avatar_url: string | null;
      correct_count: string;
      is_winner: boolean;
      prize_amount: string;
    }>;
  }>(`/contests/${contestId}/leaderboard`);
}

export function getAdminContests(accessToken: string) {
  return apiFetch<{
    contests: Array<{
      id: string;
      title: string;
      status: string;
      member_count: number;
      starts_at: string;
      prize_pool: string;
    }>;
  }>("/admin/contests", undefined, accessToken);
}

export function createContest(
  accessToken: string,
  payload: {
    title: string;
    starts_at: string;
    entry_fee: number;
    max_members: number;
    prize_rule: "all_correct" | "top_scorer";
  }
) {
  return apiFetch<{ contest: { id: string } }>(
    "/admin/contests",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );
}

export function addQuestion(
  accessToken: string,
  contestId: string,
  payload: {
    seq: number;
    body: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    correct_option: "a" | "b" | "c" | "d";
    time_limit_sec: number;
  }
) {
  return apiFetch<{ question: { id: string; seq: number } }>(
    `/admin/contests/${contestId}/questions`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );
}

export function publishContest(accessToken: string, contestId: string) {
  return apiFetch<{ success: boolean }>(
    `/admin/contests/${contestId}/publish`,
    {
      method: "POST",
      body: JSON.stringify({})
    },
    accessToken
  );
}

export function recoverContest(accessToken: string, contestId: string) {
  return apiFetch<{ success: boolean }>(
    `/admin/contests/${contestId}/recover`,
    {
      method: "POST",
      body: JSON.stringify({})
    },
    accessToken
  );
}

export function getJobs(accessToken: string) {
  return apiFetch<{
    jobs: Array<{
      job_id: string;
      queue: string;
      job_name: string;
      data?: Record<string, unknown>;
      status: string;
      attempts?: number;
      scheduled_for: string;
      failed_reason: string | null;
    }>;
  }>("/admin/jobs", undefined, accessToken);
}

export function retryJob(accessToken: string, queue: string, jobId: string) {
  return apiFetch<{ success: boolean; mode: string }>(
    `/admin/jobs/${queue}/${jobId}/retry`,
    {
      method: "POST",
      body: JSON.stringify({})
    },
    accessToken
  );
}

export function rebuildContestCache(accessToken: string, contestId: string) {
  return apiFetch<{ contestId: string; status: string }>(
    `/admin/contests/${contestId}/rebuild-cache`,
    {
      method: "POST",
      body: JSON.stringify({})
    },
    accessToken
  );
}

export function getAdminUsers(accessToken: string) {
  return apiFetch<{
    users: Array<{
      id: string;
      email: string;
      name: string;
      wallet_balance: string;
      is_admin: boolean;
      is_banned: boolean;
      created_at: string;
    }>;
  }>("/admin/users", undefined, accessToken);
}

export function creditUserWallet(accessToken: string, userId: string, amount: number) {
  return apiFetch<{ success: boolean; wallet_balance: string }>(
    `/admin/users/${userId}/wallet/credit`,
    {
      method: "POST",
      body: JSON.stringify({ amount })
    },
    accessToken
  );
}

export function getAdminWalletRequests(accessToken: string) {
  return apiFetch<{
    requests: Array<{
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
    }>;
  }>("/admin/wallet-requests", undefined, accessToken);
}

export function reviewWalletRequest(
  accessToken: string,
  requestId: string,
  status: "approved" | "rejected"
) {
  return apiFetch<{
    success: boolean;
    status: "approved" | "rejected";
    request_id: string;
    user_name: string;
    wallet_balance?: string;
  }>(
    `/admin/wallet-requests/${requestId}/review`,
    {
      method: "POST",
      body: JSON.stringify({ status })
    },
    accessToken
  );
}
