import type { Provider } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SDK_PACKAGE = "@earendil-works/pi-coding-agent";

function resolvedSdkPackageDir(cwd: string): string {
  // Next.js runs the server with the project as cwd, and resolves externals
  // from its build output inside the project, so both find the same package.
  const manifestPath = findPackageJSON(SDK_PACKAGE, pathToFileURL(join(cwd, "package.json")).href);
  if (!manifestPath) throw new Error(`cannot resolve ${SDK_PACKAGE} from ${cwd}`);
  return realpathSync(join(manifestPath, ".."));
}

async function importFile(path: string): Promise<Record<string, unknown>> {
  // Loaded at runtime from the SDK's own files, never bundled: a bundled copy
  // would be a second module instance, and the bundler cannot resolve a path
  // it only knows at run time.
  return await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path).href) as Record<string, unknown>;
}

// The CLI's /llama command needs its TUI. Load just its provider for the web.
export const llamaCppExtension: InlineExtension = {
  name: "llama.cpp",
  builtin: true,
  async factory(pi) {
    const path = join(resolvedSdkPackageDir(process.cwd()), "dist/extensions/llama/provider.js");
    const { createLlamaProvider } = await importFile(path) as { createLlamaProvider(): { provider: Provider } };
    pi.registerProvider(createLlamaProvider().provider);
  },
};
