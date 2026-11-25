// Download mirrors for the desktop toolchain. GitHub releases are slow or
// unreachable from some networks, so every download the desktop scripts cause
// goes through a mirror by default; an environment variable always wins.
//
// The defaults live in package.json's `config` block, which npm exports to
// scripts as npm_package_config_*, so they are also visible to electron-builder
// when it is started through npm.

const DEFAULTS = {
  electron: "https://npmmirror.com/mirrors/electron/",
  binaries: "https://npmmirror.com/mirrors/electron-builder-binaries/",
};

function resolveMirrors(env = process.env) {
  return {
    // Electron's own downloader (@electron/get) reads these names.
    electron:
      env.ELECTRON_MIRROR?.trim()
      || env.npm_config_electron_mirror?.trim()
      || env.npm_package_config_electron_mirror?.trim()
      || DEFAULTS.electron,
    // electron-builder's toolset downloads (NSIS, 7zip, icons) read these.
    binaries:
      env.ELECTRON_BUILDER_BINARIES_MIRROR?.trim()
      || env.npm_config_electron_builder_binaries_mirror?.trim()
      || env.npm_package_config_electron_builder_binaries_mirror?.trim()
      || DEFAULTS.binaries,
  };
}

/** The environment every desktop download step runs with. */
function withMirrorEnv(env = process.env) {
  const mirrors = resolveMirrors(env);
  return {
    ...env,
    ELECTRON_MIRROR: mirrors.electron,
    ELECTRON_BUILDER_BINARIES_MIRROR: mirrors.binaries,
  };
}

module.exports = { resolveMirrors, withMirrorEnv, DEFAULT_MIRRORS: DEFAULTS };
