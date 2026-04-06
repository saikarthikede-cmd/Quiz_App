"use client";

import { useParams } from "next/navigation";

import { LoginCard } from "../../../../components/login-card";
import { SiteShell } from "../../../../components/site-shell";
import { buildTenantPath } from "../../../../lib/tenant";

export default function TenantLoginPage() {
  const params = useParams<{ slug: string }>();
  const tenantSlug = typeof params.slug === "string" ? params.slug : null;

  return (
    <SiteShell
      title="Tenant Login"
      subtitle="Sign in with Google inside the selected organization workspace."
    >
      <LoginCard
        tenantSlug={tenantSlug}
        targetHref={buildTenantPath(tenantSlug, "/dashboard")}
      />
    </SiteShell>
  );
}
