export function normalizeTenantSlug(slug: string) {
  return slug.trim().toLowerCase();
}

export function extractTenantSlugFromPath(pathname?: string | null) {
  if (!pathname) {
    return null;
  }

  const match = pathname.match(/^\/t\/([^/]+)/);
  return match?.[1] ? normalizeTenantSlug(match[1]) : null;
}

export function buildTenantPath(tenantSlug: string | null | undefined, path = "") {
  if (!tenantSlug) {
    return "/";
  }

  const normalizedSlug = normalizeTenantSlug(tenantSlug);
  const normalizedPath = path.length === 0 ? "" : path.startsWith("/") ? path : `/${path}`;
  return `/t/${normalizedSlug}${normalizedPath}`;
}

export function resolveRouteTenantSlug(explicitTenantSlug?: string | null) {
  if (explicitTenantSlug && explicitTenantSlug.trim().length > 0) {
    return normalizeTenantSlug(explicitTenantSlug);
  }

  if (typeof window === "undefined") {
    return null;
  }

  return extractTenantSlugFromPath(window.location.pathname);
}
