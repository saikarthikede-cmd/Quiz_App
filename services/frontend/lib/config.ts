const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const DEFAULT_GAME_URL = process.env.NEXT_PUBLIC_GAME_URL ?? "http://localhost:4001";

function isPrivateIpv4(hostname: string) {
  return (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function resolveBrowserServiceUrl(defaultUrl: string, port: number) {
  if (typeof window === "undefined") {
    return defaultUrl;
  }

  const { protocol, hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1" || isPrivateIpv4(hostname)) {
    return `${protocol}//${hostname}:${port}`;
  }

  return defaultUrl;
}

export const API_URL = resolveBrowserServiceUrl(DEFAULT_API_URL, 4000);
export const GAME_URL = resolveBrowserServiceUrl(DEFAULT_GAME_URL, 4001);
