import path from "node:path"
import { fileURLToPath } from "node:url"

const webRoot = path.dirname(fileURLToPath(import.meta.url))

function isJsquashAvifCircularChunkWarning(warning, compilation) {
  const match = warning.message?.match(
    /^Circular dependency between chunks with runtime \(([^)]+)\)/,
  )
  if (!match) return false
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
    "@picbind/image-wasm",
    "@picbind/perceptual-wasm",
    "@picbind/ui",
  ],
  ...(process.env.NODE_ENV === "development"
    ? {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [
                { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
                { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
              ],
            },
          ]
        },
      }
    : {}),
  webpack(config, { isServer }) {
    if (process.env.NODE_ENV === "production" && !isServer) {
      config.optimization.realContentHash = false
    }

    config.resolve.modules = [
      path.resolve(webRoot, "node_modules"),
      ...(config.resolve.modules ?? ["node_modules"]),
    ]
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    }

    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg'),
    )

    config.module.rules.push(
      {
        test: /\.(wasm|mjs)$/i,
        resourceQuery: /url/,
        type: 'asset/resource',
      },
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/,
      },
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...fileLoaderRule.resourceQuery.not, /url/] },
        use: ['@svgr/webpack'],
      },
    )
    fileLoaderRule.exclude = /\.svg$/i

    if (isServer) {
      config.resolve.alias = { ...config.resolve.alias, canvas: false }
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
      { protocol: "https", hostname: "file.302.ai" },
      { protocol: "https", hostname: "file.302ai.cn" },
    ],
  },
}

export default nextConfig
