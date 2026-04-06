"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { LoginCard } from "../../components/login-card";
import { SiteShell } from "../../components/site-shell";
import { useFrontendSession } from "../../components/session-panel";
import {
  addQuestion,
  creditUserWallet,
  createTenant,
  createContest,
  deleteAdminUser,
  deleteTenant,
  deletePlatformUser,
  getPlatformTenantAdminRequests,
  getAdminContests,
  getAdminUsers,
  getAdminWalletRequests,
  getJobs,
  getPlatformUsers,
  getTenants,
  publishContest,
  rebuildContestCache,
  recoverContest,
  reviewPlatformAccessRequest,
  reviewWalletRequest,
  retryJob,
  setPlatformCompanyAdmin,
  updateTenant
} from "../../lib/api";
import { buildTenantPath } from "../../lib/tenant";

interface AdminContest {
  id: string;
  title: string;
  status: string;
  member_count: number;
  starts_at: string;
  prize_pool: string;
  question_count: string;
  start_job_status: string;
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
  user_type?: "individual" | "student" | "employee" | null;
  membership_type?: string | null;
  created_at: string;
}

interface WalletRequestItem {
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
}

interface TenantItem {
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
}

interface PlatformUserItem extends AdminUser {
  is_platform_admin: boolean;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  user_type?: "individual" | "student" | "employee" | null;
  membership_type: string | null;
  onboarding_completed: boolean;
}

function canPromoteToCompanyAdmin(user: PlatformUserItem, tenantSlug: string | null) {
  return !user.is_platform_admin && tenantSlug !== "default" && user.user_type === "employee";
}

function getCompanyAdminActionHint(user: PlatformUserItem, tenantSlug: string | null) {
  if (user.is_platform_admin) {
    return "Platform admin access is managed separately.";
  }

  if (tenantSlug === "default") {
    return "Public/default users do not use company-admin access.";
  }

  if (user.user_type !== "employee") {
    return "Only employees of this company can become company admins.";
  }

  return null;
}

interface TenantAdminOverview {
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
}

export default function AdminPage() {
  const params = useParams<{ slug?: string }>();
  const router = useRouter();
  const tenantSlug = typeof params.slug === "string" ? params.slug : null;
  const { session, isReady } = useFrontendSession();
  const [contests, setContests] = useState<AdminContest[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [platformUsers, setPlatformUsers] = useState<PlatformUserItem[]>([]);
  const [walletRequests, setWalletRequests] = useState<WalletRequestItem[]>([]);
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [selectedTenantView, setSelectedTenantView] = useState<"users" | "admins">("users");
  const [selectedTenantOverview, setSelectedTenantOverview] = useState<TenantAdminOverview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeUserAction, setActiveUserAction] = useState<{
    userId: string;
    label: string;
    kind: "pending" | "success" | "error";
  } | null>(null);
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
  const [tenantForm, setTenantForm] = useState({
    name: "",
    slug: "",
    plan: "standard" as "standard" | "pro" | "enterprise",
    company_type: "company" as "college" | "company",
    code_or_reference_id: "",
    id_pattern: ""
  });

  async function loadAdminData(accessToken: string, isPlatformAdmin = false) {
    const loadId = ++latestLoadId.current;
    setPageLoading(true);
    setError(null);

    try {
      const [contestResult, jobsResult, usersResult, walletRequestsResult, tenantsResult] = await Promise.all([
        getAdminContests(accessToken),
        getJobs(accessToken),
        getAdminUsers(accessToken),
        getAdminWalletRequests(accessToken),
        isPlatformAdmin ? getTenants(accessToken) : Promise.resolve({ tenants: [] as TenantItem[] })
      ]);

      if (loadId !== latestLoadId.current) {
        return;
      }

      setContests(contestResult.contests);
      setJobs(jobsResult.jobs);
      setUsers(usersResult.users);
      setWalletRequests(walletRequestsResult.requests);
      setTenants(tenantsResult.tenants);

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

  async function loadPlatformOverview(accessToken: string) {
    const loadId = ++latestLoadId.current;
    setPageLoading(true);
    setError(null);

    try {
      const [tenantsResult, platformUsersResult] = await Promise.all([
        getTenants(accessToken),
        getPlatformUsers(accessToken)
      ]);

      if (loadId !== latestLoadId.current) {
        return;
      }

      setTenants(tenantsResult.tenants);
      setPlatformUsers(platformUsersResult.users);
    } catch (loadError) {
      if (loadId !== latestLoadId.current) {
        return;
      }

      setError(loadError instanceof Error ? loadError.message : "Failed to load platform overview");
    } finally {
      if (loadId === latestLoadId.current) {
        setPageLoading(false);
      }
    }
  }

  async function loadTenantManagement(accessToken: string, tenantId: string) {
    try {
      const result = await getPlatformTenantAdminRequests(accessToken, tenantId);
      setSelectedTenantOverview(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load tenant management data");
    }
  }

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (!tenantSlug && !session?.isPlatformAdmin) {
      router.replace("/");
      return;
    }
  }, [isReady, router, session?.isPlatformAdmin, tenantSlug]);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    if (!tenantSlug) {
      if (session.isPlatformAdmin) {
        void loadPlatformOverview(session.accessToken);
      }
      return;
    }

    if (session.isAdmin || session.isPlatformAdmin) {
      void loadAdminData(session.accessToken, session.isPlatformAdmin);
    }
  }, [session, tenantSlug]);

  useEffect(() => {
    if (!session?.isPlatformAdmin || !selectedTenantId) {
      return;
    }

    void loadTenantManagement(session.accessToken, selectedTenantId);
  }, [selectedTenantId, session]);

  const selectedContest = useMemo(
    () => contests.find((contest) => contest.id === selectedContestId) ?? null,
    [contests, selectedContestId]
  );
  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null,
    [selectedTenantId, tenants]
  );
  const selectedTenantUsers = useMemo(
    () => (selectedTenantId ? platformUsers.filter((user) => user.tenant_id === selectedTenantId) : []),
    [platformUsers, selectedTenantId]
  );
  const activeJobs = jobs.filter((job) => job.status !== "failed").length;
  const pendingWalletRequests = walletRequests.filter((request) => request.status === "pending").length;
  const visibleContests = contests.slice(0, 3);

  function renderUserActionNotice(userId: string) {
    if (!activeUserAction || activeUserAction.userId !== userId) {
      return null;
    }

    const className =
      activeUserAction.kind === "error"
        ? "notice error"
        : activeUserAction.kind === "success"
          ? "notice"
          : "notice warn";

    return (
      <div className={className} style={{ marginTop: 10 }}>
        {activeUserAction.label}
      </div>
    );
  }

  if (!isReady) {
    return (
      <SiteShell title="Admin Console" subtitle="Loading admin session...">
        <div className="notice">Checking saved session...</div>
      </SiteShell>
    );
  }

  if (!tenantSlug && !session?.isPlatformAdmin) {
    return (
      <SiteShell title="Admin Console" subtitle="Resolving organization workspace...">
        <div className="notice">Redirecting to organization selection...</div>
      </SiteShell>
    );
  }

  if (!session) {
    return (
      <SiteShell
        title="Admin Console"
        subtitle="Sign in as the main admin or a company admin to open the correct management surface."
      >
        <LoginCard tenantSlug={tenantSlug} targetHref={tenantSlug ? buildTenantPath(tenantSlug, "/admin") : "/admin"} />
      </SiteShell>
    );
  }

  if (!session.isAdmin && !session.isPlatformAdmin) {
    return (
      <SiteShell title="Admin Console" subtitle="This route is reserved for admin users.">
        <div className="notice error">
          The current session does not have admin access for this workspace.
        </div>
      </SiteShell>
    );
  }

  if (!tenantSlug && session.isPlatformAdmin) {
    return (
      <SiteShell
        title="Main Admin Console"
        subtitle="Create companies, manage company admins, and open any company in admin or player mode from one platform workspace."
      >
        {pageLoading ? <div className="notice">Refreshing platform data...</div> : null}
        {message ? <div className="notice">{message}</div> : null}
        {error ? <div className="notice error" style={{ marginTop: 14 }}>{error}</div> : null}

        <section className="signal-grid" style={{ marginTop: 20 }}>
          <div className="signal-card">
            <div className="signal-label">Companies</div>
            <div className="signal-value">{tenants.length}</div>
          </div>
          <div className="signal-card gold">
            <div className="signal-label">Users</div>
            <div className="signal-value">{platformUsers.length}</div>
          </div>
          <div className="signal-card rose">
            <div className="signal-label">Company Admins</div>
            <div className="signal-value">{platformUsers.filter((user) => user.is_admin && !user.is_platform_admin).length}</div>
          </div>
        </section>

        <div className="grid two" style={{ marginTop: 20 }}>
          <div className="card">
            <div className="eyebrow">Create Company</div>
            <h3 style={{ marginTop: 16, marginBottom: 10 }}>Register a college or company before users onboard</h3>
            <div className="grid two">
              <label className="field">
                <span>Name</span>
                <input value={tenantForm.name} onChange={(event) => setTenantForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label className="field">
                <span>Slug</span>
                <input value={tenantForm.slug} onChange={(event) => setTenantForm((current) => ({ ...current, slug: event.target.value.toLowerCase() }))} />
              </label>
            </div>
            <div className="grid two">
              <label className="field">
                <span>Type</span>
                <select value={tenantForm.company_type} onChange={(event) => setTenantForm((current) => ({ ...current, company_type: event.target.value as "college" | "company" }))}>
                  <option value="company">company</option>
                  <option value="college">college</option>
                </select>
              </label>
              <label className="field">
                <span>Plan</span>
                <select value={tenantForm.plan} onChange={(event) => setTenantForm((current) => ({ ...current, plan: event.target.value as "standard" | "pro" | "enterprise" }))}>
                  <option value="standard">standard</option>
                  <option value="pro">pro</option>
                  <option value="enterprise">enterprise</option>
                </select>
              </label>
            </div>
            <div className="grid two">
              <label className="field">
                <span>Reference Code</span>
                <input value={tenantForm.code_or_reference_id} onChange={(event) => setTenantForm((current) => ({ ...current, code_or_reference_id: event.target.value }))} />
              </label>
              <label className="field">
                <span>ID Pattern</span>
                <input value={tenantForm.id_pattern} onChange={(event) => setTenantForm((current) => ({ ...current, id_pattern: event.target.value }))} />
              </label>
            </div>
            <button
              type="button"
              className="solid-button"
              onClick={() => {
                setMessage(null);
                setError(null);
                void (async () => {
                  try {
                    const result = await createTenant(session.accessToken, tenantForm);
                    setMessage(`Created company ${result.tenant.slug}`);
                    setTenantForm({
                      name: "",
                      slug: "",
                      plan: "standard",
                      company_type: "company",
                      code_or_reference_id: "",
                      id_pattern: ""
                    });
                    await loadPlatformOverview(session.accessToken);
                  } catch (createError) {
                    setError(createError instanceof Error ? createError.message : "Company creation failed");
                  }
                })();
              }}
            >
              Create Company
            </button>
          </div>

          <div className="card">
            <div className="eyebrow">Company Directory</div>
            <h3 style={{ marginTop: 16, marginBottom: 10 }}>Open company consoles or manage users and admin requests</h3>
            <div className="list">
              {tenants.map((tenant) => (
                <div key={tenant.id} className="notice">
                  <div className="stack-row spread">
                    <div>
                      <strong>{tenant.name}</strong>
                      <div className="muted"><span className="mono">{tenant.slug}</span> - {tenant.company_type}</div>
                    </div>
                    <div className="pill-row">
                      <span className="pill gold">{tenant.user_count} users</span>
                      <span className="pill">{tenant.admin_count} admins</span>
                    </div>
                  </div>
                  <div className="stack-row" style={{ marginTop: 12 }}>
                    <Link href={buildTenantPath(tenant.slug, "/admin")} className="solid-button">Open Admin Mode</Link>
                    <Link href={buildTenantPath(tenant.slug, "/dashboard")} className="ghost-button">Open Player Mode</Link>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setSelectedTenantId(tenant.id);
                        setSelectedTenantView("users");
                        setSelectedTenantOverview(null);
                      }}
                    >
                      Manage Users
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setSelectedTenantId(tenant.id);
                        setSelectedTenantView("admins");
                        void loadTenantManagement(session.accessToken, tenant.id);
                      }}
                    >
                      Manage Admins
                    </button>
                    {tenant.slug !== "default" ? (
                      <button
                        type="button"
                        className="rose-button"
                        onClick={() => {
                          void (async () => {
                            try {
                              await deleteTenant(session.accessToken, tenant.id);
                              setMessage(`Deleted company ${tenant.slug}`);
                              if (selectedTenantId === tenant.id) {
                                setSelectedTenantId(null);
                                setSelectedTenantOverview(null);
                              }
                              await loadPlatformOverview(session.accessToken);
                            } catch (tenantError) {
                              setError(tenantError instanceof Error ? tenantError.message : "Tenant delete failed");
                            }
                          })();
                        }}
                      >
                        Delete Company
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {selectedTenant ? (
          <div className="card" style={{ marginTop: 20 }}>
            <div className="eyebrow">
              {selectedTenantView === "users" ? "Manage Users" : "Manage Admins"}
            </div>
            <h3 style={{ marginTop: 16, marginBottom: 10 }}>
              {selectedTenant.name} ({selectedTenant.slug})
            </h3>

            {selectedTenantView === "users" ? (
              <div className="list" style={{ marginTop: 16 }}>
                {selectedTenantUsers.length === 0 ? (
                  <div className="notice warn">No users in this company yet.</div>
                ) : null}
                {selectedTenantUsers.map((user) => (
                  <div key={user.id} className="notice">
                    {(() => {
                      const adminActionHint = getCompanyAdminActionHint(user, selectedTenant.slug);
                      const canToggleCompanyAdmin =
                        user.is_admin || canPromoteToCompanyAdmin(user, selectedTenant.slug);

                      return (
                        <>
                    <div className="stack-row spread">
                      <div>
                        <strong>{user.name}</strong>
                        <div className="muted">{user.email}</div>
                      </div>
                      <div className="pill-row">
                        <span className="pill gold">{user.user_type ?? "unassigned"}</span>
                        {user.is_admin ? <span className="pill">Admin</span> : null}
                      </div>
                    </div>
                    {!user.is_platform_admin ? (
                      <div className="stack-row" style={{ marginTop: 12 }}>
                        {canToggleCompanyAdmin ? (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              void (async () => {
                                try {
                                setMessage(null);
                                setError(null);
                                setActiveUserAction({
                                  userId: user.id,
                                  label: `${!user.is_admin ? "Promoting" : "Removing admin access for"} ${user.name}...`,
                                  kind: "pending"
                                });
                                await setPlatformCompanyAdmin(session.accessToken, user.id, !user.is_admin);
                                setMessage(`${user.name} is now ${!user.is_admin ? "a company admin" : "a player"}`);
                                setActiveUserAction({
                                  userId: user.id,
                                  label: `${user.name} is now ${!user.is_admin ? "a company admin" : "a player"}.`,
                                  kind: "success"
                                });
                                await loadPlatformOverview(session.accessToken);
                                await loadTenantManagement(session.accessToken, selectedTenant.id);
                              } catch (actionError) {
                                setActiveUserAction({
                                  userId: user.id,
                                  label: actionError instanceof Error ? actionError.message : "Admin update failed",
                                  kind: "error"
                                });
                                setError(actionError instanceof Error ? actionError.message : "Admin update failed");
                              }
                            })();
                          }}
                          >
                            {user.is_admin ? "Remove Admin" : "Make Admin"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="rose-button"
                          onClick={() => {
                            void (async () => {
                              try {
                                setMessage(null);
                                setError(null);
                                setActiveUserAction({
                                  userId: user.id,
                                  label: `Removing ${user.name}...`,
                                  kind: "pending"
                                });
                                await deletePlatformUser(session.accessToken, user.id);
                                setMessage(`Removed ${user.name}`);
                                setActiveUserAction({
                                  userId: user.id,
                                  label: `${user.name} was removed successfully.`,
                                  kind: "success"
                                });
                                await loadPlatformOverview(session.accessToken);
                                await loadTenantManagement(session.accessToken, selectedTenant.id);
                              } catch (actionError) {
                                setActiveUserAction({
                                  userId: user.id,
                                  label: actionError instanceof Error ? actionError.message : "User removal failed",
                                  kind: "error"
                                });
                                setError(actionError instanceof Error ? actionError.message : "User removal failed");
                              }
                            })();
                          }}
                        >
                          Remove User
                        </button>
                      </div>
                    ) : null}
                    {!canToggleCompanyAdmin && adminActionHint ? (
                      <div className="muted" style={{ marginTop: 10 }}>{adminActionHint}</div>
                    ) : null}
                    {renderUserActionNotice(user.id)}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            ) : (
              <div className="list" style={{ marginTop: 16 }}>
                {selectedTenantOverview?.admins.length ? (
                  <div className="notice">
                    <strong>Current approved admins</strong>
                    <div className="pill-row" style={{ marginTop: 10 }}>
                      {selectedTenantOverview.admins.map((admin) => (
                        <span key={admin.id} className="pill gold">
                          {admin.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="notice warn">No approved admins for this company yet.</div>
                )}

                {selectedTenantOverview?.admin_requests.map((adminRequest) => (
                  <div key={adminRequest.id} className="notice">
                    <strong>{adminRequest.user_name}</strong>
                    <div className="muted">{adminRequest.user_email}</div>
                    <div className="muted">Requested admin access on {new Date(adminRequest.created_at).toLocaleString()}</div>
                    {adminRequest.notes ? <div className="muted" style={{ marginTop: 8 }}>{adminRequest.notes}</div> : null}
                    <div className="stack-row" style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="solid-button"
                        onClick={() => {
                          void (async () => {
                            try {
                              setMessage(null);
                              setError(null);
                              await reviewPlatformAccessRequest(session.accessToken, adminRequest.id, "approved");
                              setMessage(`Approved admin access for ${adminRequest.user_name}`);
                              await loadPlatformOverview(session.accessToken);
                              await loadTenantManagement(session.accessToken, selectedTenant.id);
                            } catch (actionError) {
                              setError(actionError instanceof Error ? actionError.message : "Admin request approval failed");
                            }
                          })();
                        }}
                      >
                        Accept Admin Request
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          void (async () => {
                            try {
                              setMessage(null);
                              setError(null);
                              await reviewPlatformAccessRequest(session.accessToken, adminRequest.id, "rejected");
                              setMessage(`Rejected admin access for ${adminRequest.user_name}`);
                              await loadPlatformOverview(session.accessToken);
                              await loadTenantManagement(session.accessToken, selectedTenant.id);
                            } catch (actionError) {
                              setError(actionError instanceof Error ? actionError.message : "Admin request rejection failed");
                            }
                          })();
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}

                {selectedTenantOverview?.exit_requests.map((exitRequest) => (
                  <div key={exitRequest.id} className="notice">
                    <strong>{exitRequest.user_name}</strong>
                    <div className="muted">{exitRequest.user_email}</div>
                    <div className="muted">Requested exit on {new Date(exitRequest.created_at).toLocaleString()}</div>
                    {exitRequest.notes ? <div className="muted" style={{ marginTop: 8 }}>{exitRequest.notes}</div> : null}
                    <div className="stack-row" style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="solid-button"
                        onClick={() => {
                          void (async () => {
                            try {
                              setMessage(null);
                              setError(null);
                              await reviewPlatformAccessRequest(session.accessToken, exitRequest.id, "approved");
                              setMessage(`Approved exit for ${exitRequest.user_name}`);
                              await loadPlatformOverview(session.accessToken);
                              await loadTenantManagement(session.accessToken, selectedTenant.id);
                            } catch (actionError) {
                              setError(actionError instanceof Error ? actionError.message : "Exit approval failed");
                            }
                          })();
                        }}
                      >
                        Approve Exit
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          void (async () => {
                            try {
                              setMessage(null);
                              setError(null);
                              await reviewPlatformAccessRequest(session.accessToken, exitRequest.id, "rejected");
                              setMessage(`Rejected exit for ${exitRequest.user_name}`);
                              await loadPlatformOverview(session.accessToken);
                              await loadTenantManagement(session.accessToken, selectedTenant.id);
                            } catch (actionError) {
                              setError(actionError instanceof Error ? actionError.message : "Exit rejection failed");
                            }
                          })();
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow">Global Users</div>
          <div className="list" style={{ marginTop: 16 }}>
            {platformUsers.map((user) => (
              <div key={user.id} className="notice">
                {(() => {
                  const adminActionHint = getCompanyAdminActionHint(user, user.tenant_slug);
                  const canToggleCompanyAdmin = user.is_admin || canPromoteToCompanyAdmin(user, user.tenant_slug);

                  return (
                    <>
                <div className="stack-row spread">
                  <div>
                    <strong>{user.name}</strong>
                    <div className="muted">{user.email}</div>
                    <div className="muted"><span className="mono">{user.tenant_slug}</span> - {user.tenant_name}</div>
                  </div>
                  <div className="pill-row">
                    {user.is_platform_admin ? <span className="pill rose">Main Admin</span> : null}
                    {user.is_admin && !user.is_platform_admin ? <span className="pill">Company Admin</span> : null}
                    <span className="pill gold">{user.membership_type ?? "unassigned"}</span>
                  </div>
                </div>
                {!user.is_platform_admin ? (
                  <div className="stack-row" style={{ marginTop: 12 }}>
                    {canToggleCompanyAdmin ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          void (async () => {
                            try {
                            setMessage(null);
                            setError(null);
                            setActiveUserAction({
                              userId: user.id,
                              label: `${!user.is_admin ? "Promoting" : "Removing admin access for"} ${user.name}...`,
                              kind: "pending"
                            });
                            await setPlatformCompanyAdmin(session.accessToken, user.id, !user.is_admin);
                            setMessage(`${user.name} is now ${!user.is_admin ? "a company admin" : "a player"}`);
                            setActiveUserAction({
                              userId: user.id,
                              label: `${user.name} is now ${!user.is_admin ? "a company admin" : "a player"}.`,
                              kind: "success"
                            });
                            await loadPlatformOverview(session.accessToken);
                          } catch (actionError) {
                            setActiveUserAction({
                              userId: user.id,
                              label: actionError instanceof Error ? actionError.message : "Admin update failed",
                              kind: "error"
                            });
                            setError(actionError instanceof Error ? actionError.message : "Admin update failed");
                          }
                        })();
                        }}
                      >
                        {user.is_admin ? "Remove Admin" : "Make Admin"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rose-button"
                      onClick={() => {
                        void (async () => {
                          try {
                            setMessage(null);
                            setError(null);
                            setActiveUserAction({
                              userId: user.id,
                              label: `Removing ${user.name}...`,
                              kind: "pending"
                            });
                            await deletePlatformUser(session.accessToken, user.id);
                            setMessage(`Removed ${user.name}`);
                            setActiveUserAction({
                              userId: user.id,
                              label: `${user.name} was removed successfully.`,
                              kind: "success"
                            });
                            await loadPlatformOverview(session.accessToken);
                          } catch (actionError) {
                            setActiveUserAction({
                              userId: user.id,
                              label: actionError instanceof Error ? actionError.message : "User removal failed",
                              kind: "error"
                            });
                            setError(actionError instanceof Error ? actionError.message : "User removal failed");
                          }
                        })();
                      }}
                    >
                      Remove User
                    </button>
                  </div>
                ) : null}
                {!canToggleCompanyAdmin && adminActionHint ? (
                  <div className="muted" style={{ marginTop: 10 }}>{adminActionHint}</div>
                ) : null}
                {renderUserActionNotice(user.id)}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="Admin Console"
      subtitle="Create draft contests, attach questions, publish schedules, and monitor queue, cache, and payout paths from one sharper operations surface."
    >
      {pageLoading ? <div className="notice">Refreshing admin data...</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error" style={{ marginTop: 14 }}>{error}</div> : null}

      <section className="spotlight-card" style={{ marginTop: 20 }}>
        <div className="spotlight-grid">
          <div className="spotlight-copy">
            <div className="eyebrow">Operations View</div>
            <h2 className="spotlight-title">Run contests, control payouts, and keep the tenant healthy from one place.</h2>
            <p className="muted hero-kicker">
              The admin surface now keeps creation, moderation, job tracking, and provisioning closer together so daily actions feel faster.
            </p>
            <div className="spotlight-actions">
              <button
                type="button"
                className="solid-button"
                onClick={() => {
                  void loadAdminData(session.accessToken, session.isPlatformAdmin);
                }}
              >
                Refresh Admin Data
              </button>
              {selectedContestId ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setMessage(`Selected contest ${selectedContestId}`);
                  }}
                >
                  Review Selected Contest
                </button>
              ) : null}
            </div>
          </div>

          <div className="spotlight-stats">
            <div className="rail-card">
              <div className="rail-label">Contest Inventory</div>
              <div className="rail-value">{contests.length}</div>
              <div className="rail-copy">Draft, scheduled, live, ended, and cancelled rooms tracked together.</div>
            </div>
            <div className="rail-card">
              <div className="rail-label">Pending Money Requests</div>
              <div className="rail-value">{pendingWalletRequests}</div>
              <div className="rail-copy">Add-money and redeem requests waiting on admin action before balances change.</div>
            </div>
          </div>
        </div>
      </section>

      {session.isPlatformAdmin ? (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="eyebrow">Tenant Provisioning</div>
          <h3 style={{ marginTop: 16, marginBottom: 10 }}>Create and manage organization spaces</h3>
          <div className="grid two">
            <label className="field">
              <span>Organization Name</span>
              <input
                value={tenantForm.name}
                onChange={(event) =>
                  setTenantForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Acme Corp"
              />
            </label>
            <label className="field">
              <span>Slug</span>
              <input
                value={tenantForm.slug}
                onChange={(event) =>
                  setTenantForm((current) => ({ ...current, slug: event.target.value.toLowerCase() }))
                }
                placeholder="acme"
              />
            </label>
          </div>
          <label className="field">
            <span>Plan</span>
            <select
              value={tenantForm.plan}
              onChange={(event) =>
                setTenantForm((current) => ({
                  ...current,
                  plan: event.target.value as "standard" | "pro" | "enterprise"
                }))
              }
            >
              <option value="standard">standard</option>
              <option value="pro">pro</option>
              <option value="enterprise">enterprise</option>
            </select>
          </label>
          <div className="stack-row">
            <button
              type="button"
              className="solid-button"
              onClick={() => {
                setMessage(null);
                setError(null);

                void (async () => {
                  try {
                    const result = await createTenant(session.accessToken, tenantForm);
                    setMessage(`Created tenant ${result.tenant.slug}`);
                    setTenantForm({
                      name: "",
                      slug: "",
                      plan: "standard",
                      company_type: "company",
                      code_or_reference_id: "",
                      id_pattern: ""
                    });
                    await loadAdminData(session.accessToken, session.isPlatformAdmin);
                  } catch (tenantError) {
                    setError(tenantError instanceof Error ? tenantError.message : "Tenant creation failed");
                  }
                })();
              }}
            >
              Create Tenant
            </button>
          </div>

          <div className="list" style={{ marginTop: 18 }}>
            {tenants.map((tenant) => (
              <div key={tenant.id} className="notice">
                <div className="stack-row spread">
                  <div>
                    <strong>{tenant.name}</strong>
                    <div className="muted">
                      <span className="mono">{tenant.slug}</span> - {tenant.company_type} - {tenant.plan}
                    </div>
                  </div>
                  <div className="pill-row">
                    <span className="pill">{tenant.is_active ? "active" : "inactive"}</span>
                    <span className="pill gold">{tenant.user_count} users</span>
                    <span className="pill">{tenant.admin_count} admins</span>
                    <span className="pill rose">{tenant.contest_count} contests</span>
                  </div>
                </div>
                <div className="stack-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setMessage(null);
                      setError(null);

                      void (async () => {
                        try {
                          const result = await updateTenant(session.accessToken, tenant.id, {
                            is_active: !tenant.is_active
                          });
                          setMessage(
                            `${result.tenant.slug} is now ${result.tenant.is_active ? "active" : "inactive"}`
                          );
                          await loadAdminData(session.accessToken, session.isPlatformAdmin);
                        } catch (tenantError) {
                          setError(tenantError instanceof Error ? tenantError.message : "Tenant update failed");
                        }
                      })();
                    }}
                  >
                    {tenant.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
          <div className="signal-subtitle">Pending add-money and redeem requests waiting for admin approval.</div>
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
                  await loadAdminData(session.accessToken, session.isPlatformAdmin);
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
                    await loadAdminData(session.accessToken, session.isPlatformAdmin);
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
              disabled={
                !selectedContestId ||
                !selectedContest ||
                Number(selectedContest.question_count) < 1 ||
                selectedContest.status !== "draft"
              }
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
                    await loadAdminData(session.accessToken, session.isPlatformAdmin);
                  } catch (publishError) {
                    setError(publishError instanceof Error ? publishError.message : "Publish failed");
                  }
                })();
              }}
            >
              Publish Selected Contest
            </button>
            {selectedContest && Number(selectedContest.question_count) < 1 ? (
              <div className="muted">Add at least 1 question before publishing this contest.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 22 }}>
        <div className="card">
          <div className="eyebrow">Contest Monitor</div>
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
                      <span className="pill">{contest.question_count} questions</span>
                      {contest.status !== "draft" ? (
                        <span className="pill gold">Start Job: {contest.start_job_status}</span>
                      ) : null}
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
                            await loadAdminData(session.accessToken, session.isPlatformAdmin);
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
                            await loadAdminData(session.accessToken, session.isPlatformAdmin);
                          } catch (rebuildError) {
                            setError(rebuildError instanceof Error ? rebuildError.message : "Cache rebuild failed");
                          }
                        })();
                      }}
                    >
                      Rebuild Cache
                    </button>

                    {contest.status === "ended" ? (
                      <Link href={buildTenantPath(tenantSlug, `/contests/${contest.id}/leaderboard`)} className="solid-button">
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
                          await loadAdminData(session.accessToken, session.isPlatformAdmin);
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
          <h3 style={{ marginTop: 16, marginBottom: 10 }}>Approve add-money and redeem requests before balances change</h3>
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
                    <span className="pill">{walletRequest.request_type === "add_money" ? "Add Money" : "Redeem"}</span>
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
                            await loadAdminData(session.accessToken, session.isPlatformAdmin);
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
                            await loadAdminData(session.accessToken, session.isPlatformAdmin);
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
                  await loadAdminData(session.accessToken, session.isPlatformAdmin);
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
                    {user.user_type ? <span className="pill">{user.user_type}</span> : null}
                    {user.is_admin ? <span className="pill">Admin</span> : null}
                    {user.is_banned ? <span className="pill rose">Banned</span> : null}
                  </div>
                </div>
                {user.id !== session.userId ? (
                  <div className="stack-row" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="rose-button"
                      onClick={() => {
                        void (async () => {
                          try {
                            await deleteAdminUser(session.accessToken, user.id);
                            setMessage(`Removed ${user.name} from this organization`);
                            await loadAdminData(session.accessToken, session.isPlatformAdmin);
                          } catch (userError) {
                            setError(userError instanceof Error ? userError.message : "User removal failed");
                          }
                        })();
                      }}
                    >
                      Remove User
                    </button>
                  </div>
                ) : null}
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
                        <span className="pill">{contest.question_count} questions</span>
                        {contest.status !== "draft" ? (
                          <span className="pill gold">Start Job: {contest.start_job_status}</span>
                        ) : null}
                      </div>
                    </div>
                    {contest.status === "ended" ? (
                      <Link href={buildTenantPath(tenantSlug, `/contests/${contest.id}/leaderboard`)} className="solid-button">
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
