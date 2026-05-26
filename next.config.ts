import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

function getAllowedDevOrigins() {
  const origins = new Set(["127.0.0.1"]);
  const extraOrigins = process.env.NEXT_DEV_ALLOWED_ORIGINS?.split(",") ?? [];

  for (const origin of extraOrigins) {
    const trimmedOrigin = origin.trim();

    if (!trimmedOrigin) {
      continue;
    }

    if (!trimmedOrigin.includes("://") && /[/?#\s]/.test(trimmedOrigin)) {
      continue;
    }

    try {
      const isBareHostWithPort =
        /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*):\d+$/.test(
          trimmedOrigin,
        ) || /^\[[0-9A-Fa-f:]+\]:\d+$/.test(trimmedOrigin);
      const hasExplicitScheme =
        /^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmedOrigin) && !isBareHostWithPort;
      const normalizedOriginUrl = new URL(
        hasExplicitScheme ? trimmedOrigin : `http://${trimmedOrigin}`,
      );

      if (
        hasExplicitScheme &&
        normalizedOriginUrl.protocol !== "http:" &&
        normalizedOriginUrl.protocol !== "https:"
      ) {
        continue;
      }

      const normalizedOrigin = normalizedOriginUrl.hostname;

      if (normalizedOrigin) {
        origins.add(normalizedOrigin);
      }
    } catch {
      continue;
    }
  }

  return [...origins];
}

export default function nextConfig(phase: string): NextConfig {
  return {
    ...(phase === PHASE_DEVELOPMENT_SERVER
      ? { allowedDevOrigins: getAllowedDevOrigins() }
      : {}),
    output: "standalone",
    assetPrefix: process.env.NEXT_ASSET_PREFIX || undefined,
    experimental: {
      proxyClientMaxBodySize: "50mb",
    },
  };
}
