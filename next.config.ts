import type { NextConfig } from "next";

// cacheComponents is left off on purpose: every page shows live plant data.
const nextConfig: NextConfig = {
  // Dev only: lets the dev server be opened from the LAN address.
  allowedDevOrigins: ["192.168.1.200"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
