import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Static HTML export — no server runtime needed, all pages are client-hydrated
  output: "export",
  // Allow Turbopack to resolve symlinks pointing to the parent workspace dir
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Turbopack (Next.js 16 default)
  turbopack: {},
  // Ensure file: workspace packages are transpiled by Next.js
  transpilePackages: ["@poe/sdk"],
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webpack = require("webpack");
    config.plugins = [
      ...(config.plugins ?? []),
      new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }),
    ];
    return config;
  },
};

export default nextConfig;
