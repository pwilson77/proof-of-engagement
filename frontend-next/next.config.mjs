import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
    const webpack = require("webpack");
    config.plugins = [
      ...(config.plugins ?? []),
      new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }),
    ];
    return config;
  },
};

export default nextConfig;
