import type { NextConfig } from "next";

// The shop is a static export: plain files that any static host can serve. All dynamic behaviour happens in
// the browser against the database's REST endpoint (see lib/api.ts and docs/CONTRACT.md).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: basePath || undefined,
  reactStrictMode: true,
  images: { unoptimized: true }, // pictures are pre-sized at build or upload time, never per request
};
export default config;
