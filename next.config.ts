import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@xenova/transformers',
    'onnxruntime-node',
    'onnxruntime-web',
  ],
};

export default nextConfig;

