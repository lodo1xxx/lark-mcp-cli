import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Expose native better-sqlite3 binary in server bundles
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
