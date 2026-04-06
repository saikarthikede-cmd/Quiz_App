import { clearStoredSession, getStoredSession, setStoredSession } from "./session";
import { API_URL } from "./config";
import { resolveRouteTenantSlug } from "./tenant";

export interface LoginResponse {
  access_token: string;
  tenant?: {
    id: string;
    slug: string;
    name?: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    wallet_balance: string;
    is_admin: boolean;
    is_platform_admin?: boolean;
    onboarding_completed?: boolean;
    user_type?: "individual" | "student" | "employee" | null;
    username?: string | null;
    college_name?: string | null;
    student_id?: string | null;
    company_name?: string | null;
    membership_type?: string | null;
  };
}

export interface GoogleConfigResponse {
  enabled: boolean;
  client_id: string | null;
}

export interface CompanyReferenceResponse {
  exists: boolean;
  ambiguous?: boolean;
  company?: {
    id: string;
    slug: string;
    name: string;
    company_type: "college" | "company";
    id_pattern: string | null;
  };
}

let refreshPromise: Promise<string | null> | null = null;
let lastRefreshFailureReason: string | null = null;

function resolveTenantSlug(explicitTenantSlug?: string | null) {
  if (explicitTenantSlug && explicitTenantSlug.trim().length > 0) {
    return explicitTenantSlug.trim().toLowerCase();
  }

  const routeTenantSlug = resolveRouteTenantSlug();
  if (routeTenantSlug) {
    return routeTenantSlug;
  }

  const currentSession = getStoredSession();
  if (currentSession?.tenantSlug) {
    return currentSession.tenantSlug;
  }

  return "default";
}

async function runFetch(path: string, init?: RequestInit, accessToken?: string) {
  const tenantSlug = resolveTenantSlug();

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-tenant-slug": tenantSlug,
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
        let message = `Refresh failed with ${response.status}`;

        try {
          const errorBody = (await response.json()) as { message?: string };
          if (errorBody.message) {
            message = errorBody.message;
          }
        } catch {
          // Ignore parse errors.
        }

        lastRefreshFailureReason = message;

        if (
          message === "Missing refresh token cookie" ||
          message === "Refresh token is invalid or expired"
        ) {
          clearStoredSession();
        }

        return null;
      }

      const body = (await response.json()) as { access_token: string };
      const existingSession = getStoredSession();
      lastRefreshFailureReason = null;

      if (existingSession) {
        setStoredSession({
          ...existingSession,
          accessToken: body.access_token
        });
      }

      return body.access_token;
    } catch {
      lastRefreshFailureReason = "Refresh request failed";
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
    !path.startsWith("/auth/google");

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

    const shouldClearSession =
      message === "User not found" ||
      message === "Missing refresh token cookie" ||
      message === "Refresh token is invalid or expired" ||
      (response.status === 401 &&
        message === "Invalid or expired access token" &&
        lastRefreshFailureReason !== null);

    if (shouldClearSession) {
      clearStoredSession();
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function getGoogleConfig() {
  return apiFetch<GoogleConfigResponse>("/auth/google/config");
}

export function getCompanyReference(userType: "student" | "employee", name: string) {
  const query = new URLSearchParams({
    user_type: userType,
    name
  });

  return apiFetch<CompanyReferenceResponse>(`/auth/company-reference?${query.toString()}`);
}

export function loginWithGoogle(idToken: string) {
  return apiFetch<LoginResponse>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken })
  });
}

export function completeOnboarding(
  accessToken: string,
  payload:
    | {
        user_type: "individual";
        username: string;
      }
    | {
        user_type: "student";
        college_name: string;
        student_id: string;
      }
    | {
        user_type: "employee";
        company_name: string;
        company_id: string;
        request_admin_access?: boolean;
      }
) {
  return apiFetch<LoginResponse>(
    "/auth/onboarding",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );
}

export async function logout() {
  try {
    await apiFetch<{ success: boolean }>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  } finally {
    clearStoredSession();
  }
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

export function getUserRanking(accessToken: string) {
  return apiFetch<{
    ranking: Array<{
      user_id: string;
      name: string;
      rank: string;
    }>;
  }>("/users/ranking", undefined, accessToken);
}

export function getPublicUserRanking() {
  return apiFetch<{
    ranking: Array<{
      user_id: string;
      name: string;
      rank: string;
    }>;
  }>("/users/ranking");
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

export function requestRedeem(accessToken: string, amount: number) {
  return apiFetch<{
    success: boolean;
    message: string;
    request: {
      id: string;
      request_type: "redeem";
      amount: string;
      status: "pending";
      created_at: string;
    };
  }>(
    "/wallet/redeem",
    {
      method: "POST",
      body: JSON.stringify({ amount })
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
      question_count: string;
      start_job_status: string;
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
      user_type?: "individual" | "student" | "employee" | null;
      membership_type?: string | null;
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
      request_type: "add_money" | "redeem";
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

export function getTenants(accessToken: string) {
  return apiFetch<{
    tenants: Array<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      company_type: "college" | "company";
      code_or_reference_id: string | null;
      id_pattern: string | null;
      is_active: boolean;
      created_at: string;
      user_count: string;
      admin_count: string;
      contest_count: string;
    }>;
  }>("/admin/tenants", undefined, accessToken);
}

export function createTenant(
  accessToken: string,
  payload: {
    name: string;
    slug: string;
    plan: "standard" | "pro" | "enterprise";
    company_type: "college" | "company";
    code_or_reference_id?: string;
    id_pattern?: string;
  }
) {
  return apiFetch<{
    tenant: {
      id: string;
      name: string;
      slug: string;
      plan: string;
      company_type: "college" | "company";
      code_or_reference_id: string | null;
      id_pattern: string | null;
      is_active: boolean;
      created_at: string;
    };
  }>(
    "/admin/tenants",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );
}

export function updateTenant(
  accessToken: string,
  tenantId: string,
  payload: {
    name?: string;
    plan?: "standard" | "pro" | "enterprise";
    company_type?: "college" | "company";
    code_or_reference_id?: string | null;
    id_pattern?: string | null;
    is_active?: boolean;
  }
) {
  return apiFetch<{
    tenant: {
      id: string;
      name: string;
      slug: string;
      plan: string;
      company_type: "college" | "company";
      code_or_reference_id: string | null;
      id_pattern: string | null;
      is_active: boolean;
      created_at: string;
    };
  }>(
    `/admin/tenants/${tenantId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload)
    },
    accessToken
  );
}

export function getPlatformUsers(accessToken: string, tenantId?: string) {
  const suffix = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";

  return apiFetch<{
    users: Array<{
      id: string;
      email: string;
      name: string;
      wallet_balance: string;
      is_admin: boolean;
      is_platform_admin: boolean;
      is_banned: boolean;
      created_at: string;
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
      user_type?: "individual" | "student" | "employee" | null;
      membership_type: string | null;
      onboarding_completed: boolean;
    }>;
  }>(`/admin/platform/users${suffix}`, undefined, accessToken);
}

export function getPlatformTenantAdminRequests(accessToken: string, tenantId: string) {
  return apiFetch<{
    tenant: {
      id: string;
      name: string;
      slug: string;
    };
    admins: Array<{
      id: string;
      email: string;
      name: string;
      user_type: string | null;
      created_at: string;
    }>;
    admin_requests: Array<{
      id: string;
      request_type: "admin_access";
      status: "pending";
      notes: string | null;
      created_at: string;
      user_id: string;
      user_name: string;
      user_email: string;
    }>;
    exit_requests: Array<{
      id: string;
      request_type: "exit";
      status: "pending";
      notes: string | null;
      created_at: string;
      user_id: string;
      user_name: string;
      user_email: string;
    }>;
  }>(`/admin/platform/tenants/${tenantId}/admin-requests`, undefined, accessToken);
}

export function reviewPlatformAccessRequest(
  accessToken: string,
  requestId: string,
  status: "approved" | "rejected"
) {
  return apiFetch<{
    success: boolean;
    request_id: string;
    request_type: "admin_access" | "exit";
    status: "approved" | "rejected";
  }>(
    `/admin/platform/access-requests/${requestId}/review`,
    {
      method: "POST",
      body: JSON.stringify({ status })
    },
    accessToken
  );
}

export function setPlatformCompanyAdmin(accessToken: string, userId: string, isAdmin: boolean) {
  return apiFetch<{ user: { id: string; is_admin: boolean; tenant_id: string } }>(
    `/admin/platform/users/${userId}/company-admin`,
    {
      method: "PATCH",
      body: JSON.stringify({ is_admin: isAdmin })
    },
    accessToken
  );
}

export function deletePlatformUser(accessToken: string, userId: string) {
  return apiFetch<{ success: boolean }>(
    `/admin/platform/users/${userId}`,
    {
      method: "DELETE",
      body: JSON.stringify({})
    },
    accessToken
  );
}

export function deleteTenant(accessToken: string, tenantId: string) {
  return apiFetch<{ success: boolean; tenant: { id: string; slug: string } }>(
    `/admin/tenants/${tenantId}`,
    {
      method: "DELETE",
      body: JSON.stringify({})
    },
    accessToken
  );
}

export function requestAdminAccess(accessToken: string, notes?: string) {
  return apiFetch<{
    success: boolean;
    message: string;
    request: {
      id: string;
      request_type: "admin_access";
      status: "pending";
      created_at: string;
    };
  }>(
    "/requests/admin-access",
    {
      method: "POST",
      body: JSON.stringify(notes ? { notes } : {})
    },
    accessToken
  );
}

export function requestExit(accessToken: string, notes?: string) {
  return apiFetch<{
    success: boolean;
    message: string;
    request: {
      id: string;
      request_type: "exit";
      status: "pending";
      created_at: string;
    };
  }>(
    "/requests/exit",
    {
      method: "POST",
      body: JSON.stringify(notes ? { notes } : {})
    },
    accessToken
  );
}

export function getMyAccessRequests(accessToken: string) {
  return apiFetch<{
    requests: Array<{
      id: string;
      request_type: "admin_access" | "exit";
      status: "pending" | "approved" | "rejected";
      notes: string | null;
      created_at: string;
      updated_at: string;
      reviewed_at: string | null;
    }>;
  }>("/requests/mine", undefined, accessToken);
}

export function deleteAdminUser(accessToken: string, userId: string) {
  return apiFetch<{ success: boolean }>(
    `/admin/users/${userId}`,
    {
      method: "DELETE",
      body: JSON.stringify({})
    },
    accessToken
  );
}
