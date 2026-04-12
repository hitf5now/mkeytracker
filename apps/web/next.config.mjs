/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@mplus/types", "@mplus/wow-constants"],
  webpack: (config) => {
    // Shared packages use NodeNext `.js` extensions in TS imports.
    // Next.js Bundler resolution doesn't resolve .js→.ts by default.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
