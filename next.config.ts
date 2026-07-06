import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't bundle the anylist lib — it's CJS with browser-oriented deps
  // (reconnecting-websocket, protobufjs) that break when bundled for
  // serverless. Loading it from node_modules at runtime avoids that.
  serverExternalPackages: ['anylist'],
};

export default nextConfig;
