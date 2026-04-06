"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { LoginCard } from "../components/login-card";
import { SiteShell } from "../components/site-shell";
import { useFrontendSession } from "../components/session-panel";
import { completeOnboarding, getCompanyReference } from "../lib/api";
import { setStoredSession } from "../lib/session";
import { buildTenantPath } from "../lib/tenant";

type UserType = "individual" | "student" | "employee";

export default function HomePage() {
  const router = useRouter();
  const { session, isReady } = useFrontendSession();
  const [userType, setUserType] = useState<UserType>("individual");
  const [username, setUsername] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [requestAdminAccess, setRequestAdminAccess] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceHint, setReferenceHint] = useState<string | null>(null);
  const [companyExists, setCompanyExists] = useState<boolean | null>(null);

  const onboardingTitle = useMemo(
    () =>
      userType === "individual"
        ? "Public profile"
        : userType === "student"
          ? "College entry"
          : "Company entry",
    [userType]
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    if (session.isPlatformAdmin) {
      router.replace("/admin");
      return;
    }

    if (!session.onboardingCompleted) {
      return;
    }

    router.replace(
      session.isAdmin
        ? buildTenantPath(session.tenantSlug, "/admin")
        : buildTenantPath(session.tenantSlug, "/dashboard")
    );
  }, [router, session]);

  useEffect(() => {
    if (!session || session.isPlatformAdmin || session.onboardingCompleted) {
      return;
    }

    if (userType === "individual") {
      setReferenceHint(null);
      setCompanyExists(null);
      return;
    }

    const trimmedCompanyName = organizationName.trim();
    if (trimmedCompanyName.length < 2) {
      setReferenceHint(null);
      setCompanyExists(null);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await getCompanyReference(userType === "student" ? "student" : "employee", trimmedCompanyName);
          if (!active) {
            return;
          }

          setCompanyExists(result.exists);
          setReferenceHint(result.exists ? result.company?.id_pattern ?? null : null);
        } catch {
          if (!active) {
            return;
          }

          setCompanyExists(null);
          setReferenceHint(null);
        }
      })();
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [organizationName, session, userType]);

  return (
    <SiteShell
      title="Quiz Master"
      subtitle="Main admin enters the platform console directly. Everyone else signs in first, completes the right onboarding once, and then returns straight to the correct dashboard on the next login."
    >
      {!isReady ? (
        <div className="notice">Loading session...</div>
      ) : null}

      {!session ? (
        <section className="hero">
          <div className="hero-panel">
            <div className="hero-copy">
              <div className="eyebrow">Unified Entry</div>
              <h1>One platform for public contests and organization quiz workspaces.</h1>
              <p>
                Sign in with Google to enter the platform. The main admin lands in the platform console, while other users complete a one-time onboarding flow as an individual, student, or employee.
              </p>
            </div>
          </div>

          <div className="card home-side-panel">
            <LoginCard targetHref="/" />
          </div>
        </section>
      ) : null}

      {session && !session.isPlatformAdmin && !session.onboardingCompleted ? (
        <section className="spotlight-card" style={{ marginTop: 20 }}>
          <div className="spotlight-grid">
            <div className="spotlight-copy">
              <div className="eyebrow">Onboarding Flow</div>
              <h2 className="spotlight-title">Choose how you are entering this workspace.</h2>
              <p className="muted hero-kicker">
                Individuals and students stay on the public contest side. Employees join a company workspace, and can request organization admin access after they join.
              </p>
              <div className="spotlight-actions">
                <button
                  type="button"
                  className={userType === "individual" ? "solid-button" : "ghost-button"}
                  onClick={() => setUserType("individual")}
                >
                  Individual
                </button>
                <button
                  type="button"
                  className={userType === "student" ? "solid-button" : "ghost-button"}
                  onClick={() => setUserType("student")}
                >
                  Student
                </button>
                <button
                  type="button"
                  className={userType === "employee" ? "solid-button" : "ghost-button"}
                  onClick={() => setUserType("employee")}
                >
                  Employee
                </button>
              </div>
            </div>

            <div className="card soft-card">
              <div className="eyebrow">{onboardingTitle}</div>
              {userType === "individual" ? (
                <>
                  <label className="field" style={{ marginTop: 16 }}>
                    <span>Username</span>
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="quizfan_01"
                    />
                  </label>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    Individuals join the public contest side and can participate without any company linkage.
                  </div>
                </>
              ) : (
                <>
                  <label className="field" style={{ marginTop: 16 }}>
                    <span>{userType === "student" ? "College Name" : "Company Name"}</span>
                    <input
                      value={organizationName}
                      onChange={(event) => setOrganizationName(event.target.value)}
                      placeholder={userType === "student" ? "Fission College" : "Fission Labs"}
                    />
                  </label>
                  <label className="field">
                    <span>{userType === "student" ? "Student ID" : "Company ID"}</span>
                    <input
                      value={referenceId}
                      onChange={(event) => setReferenceId(event.target.value)}
                      placeholder={userType === "student" ? "COL-001" : "EMP-FL-001"}
                    />
                  </label>
                  <div className="muted" style={{ marginBottom: 12 }}>
                    The name must match a company or college already created by the main admin.
                  </div>
                </>
              )}
              {referenceHint ? (
                <div className="notice" style={{ marginBottom: 12 }}>
                  Reference pattern: <strong>{referenceHint}</strong>
                </div>
              ) : null}
              {companyExists === false ? (
                <div className="notice warn" style={{ marginBottom: 12 }}>
                  This {userType === "student" ? "college" : "company"} name is not active yet. Ask the main admin to create it first.
                </div>
              ) : null}
              {userType === "employee" ? (
                <label className="field" style={{ marginBottom: 12 }}>
                  <span>Access Choice</span>
                  <select
                    value={requestAdminAccess ? "request_admin" : "continue_user"}
                    onChange={(event) => setRequestAdminAccess(event.target.value === "request_admin")}
                  >
                    <option value="continue_user">Continue as User</option>
                    <option value="request_admin">Request Admin Access</option>
                  </select>
                </label>
              ) : null}
              {error ? <div className="notice error" style={{ marginBottom: 12 }}>{error}</div> : null}
              <button
                type="button"
                className="solid-button"
                disabled={pending}
                onClick={() => {
                  if (!session) {
                    return;
                  }

                  setPending(true);
                  setError(null);

                  void (async () => {
                    try {
                      const result =
                        userType === "individual"
                          ? await completeOnboarding(session.accessToken, {
                              user_type: "individual",
                              username
                            })
                          : userType === "student"
                            ? await completeOnboarding(session.accessToken, {
                                user_type: "student",
                                college_name: organizationName,
                                student_id: referenceId
                              })
                            : await completeOnboarding(session.accessToken, {
                                user_type: "employee",
                                company_name: organizationName,
                                company_id: referenceId,
                                request_admin_access: requestAdminAccess
                              });

                      const nextTenantSlug = result.tenant?.slug ?? session.tenantSlug;

                      setStoredSession({
                        accessToken: result.access_token,
                        email: result.user.email,
                        name: result.user.name,
                        userId: result.user.id,
                        isAdmin: result.user.is_admin,
                        isPlatformAdmin: result.user.is_platform_admin ?? false,
                        tenantSlug: nextTenantSlug,
                        onboardingCompleted: result.user.onboarding_completed ?? true,
                        userType: result.user.user_type ?? userType,
                        membershipType: result.user.membership_type ?? userType
                      });

                      router.replace(
                        result.user.is_admin
                          ? buildTenantPath(nextTenantSlug, "/admin")
                          : buildTenantPath(nextTenantSlug, "/dashboard")
                      );
                    } catch (onboardingError) {
                      setError(
                        onboardingError instanceof Error ? onboardingError.message : "Company entry failed"
                      );
                    } finally {
                      setPending(false);
                    }
                  })();
                }}
              >
                {pending ? "Saving your profile..." : "Continue"}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </SiteShell>
  );
}
