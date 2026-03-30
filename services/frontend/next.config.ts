import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const devOrigins = new Set(["localhost", "127.0.0.1"]);

for (const addresses of Object.values(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === "IPv4" && !address.internal) {
      devOrigins.add(address.address);
    }
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [...devOrigins]
};

export default nextConfig;
