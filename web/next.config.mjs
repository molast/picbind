import path from "node:path"
import { fileURLToPath } from "node:url"

const webRoot = path.dirname(fileURLToPath(import.meta.url))

function isJsquashAvifCircularChunkWarning(warning, compilation) {
  const match = warning.message?.match(
    /^Circular dependency between chunks with runtime \(([^)]+)\)/,
  )
  if (!match) return false

  // Development chunk IDs are descriptive names rather than numeric IDs.
  if (match[1].includes('jsquash_avif')) return true

  const chunkIds = new Set(
    match[1]
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value && value !== 'webpack' && value !== 'webpack-runtime'),
  )

  return [...compilation.chunks].some((chunk) => {
    if (!chunkIds.has(String(chunk.id))) return false
    return [...compilation.chunkGraph.getChunkModulesIterable(chunk)].some(
      (module) =>
        module.resource?.includes('@jsquash/avif/codec/enc/avif_enc_mt') ||
        module.identifier().includes('@jsquash/avif/codec/enc/avif_enc_mt'),
    )
  })
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: [
    "@picbind/image-codecs",
    "@picbind/room",
  ],
  ...(process.env.NODE_ENV === "development"
    ? {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [
                { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
                { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
              ],
            },
          ]
        },
      }
    : {}),
  webpack(config, { isServer }) {
    // Cloudflare Pages installs dependencies from `web`, while the Room SDK is
    // transpiled directly from the sibling `sdk/room/src` directory. Make the
    // app dependency boundary explicit so imports inside linked SDK sources do
    // not depend on a separately installed `sdk/room/node_modules` directory.
    config.resolve.modules = [
      path.resolve(webRoot, "node_modules"),
      ...(config.resolve.modules ?? ["node_modules"]),
    ]

    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg'),
    )

    config.module.rules.push(
      {
        test: /\.(wasm|mjs)$/i,
        resourceQuery: /url/,
        type: 'asset/resource',
      },
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...fileLoaderRule.resourceQuery.not, /url/] }, // exclude if *.svg?url
        use: ['@svgr/webpack'],
      },
    )

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i

    // Konva's Node entry treats `canvas` as an optional dependency. Room only
    // uses Konva in the browser, so keep that Node-only package out of the
    // prerender bundle instead of forcing the whole Room page behind ssr:false.
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
      }
    }

    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /@jsquash[\\/]avif[\\/]codec[\\/]enc[\\/]avif_enc_mt\.worker\.mjs$/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
      isJsquashAvifCircularChunkWarning,
    ]

    return config
  },

  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "file.302.ai",
      },
      {
        protocol: "https",
        hostname: "file.302ai.cn",
      },
    ],
  },
};

export default nextConfig;
