// Next.js 配置。Next 的约定：只要导出 `nextConfig` 对象即可，无需显式 register。
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// 把 pi SDK（及其原生/wasm 依赖）排除在服务端打包之外，
	// 让 Node 直接从 node_modules 里 require 它们，避免打包器处理不了原生模块。
	serverExternalPackages: [
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-ai",
	],
};

export default nextConfig;
