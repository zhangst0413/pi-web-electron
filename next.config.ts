import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Keep the pi SDK (and its native/wasm dependencies) out of the server bundle.
	serverExternalPackages: [
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-ai",
	],
};

export default nextConfig;
