/**
 * Expo Config Plugin: withLocalTileServer
 *
 * Automatically injects the LocalTileServer native module during `npx expo prebuild`.
 * This prevents the module from being lost during `prebuild --clean`.
 *
 * What it does:
 *
 * Android:
 *   1. Copies LocalTileServerModule.java and LocalTileServerPackage.java
 *   2. Adds NanoHTTPD dependency to build.gradle
 *   3. Registers LocalTileServerPackage in MainApplication.kt
 *   4. Copies bundled font .pbf files to assets/fonts/
 *
 * iOS:
 *   1. Copies LocalTileServer.swift to the Xcode project directory
 */

const {
  withMainApplication,
  withAppBuildGradle,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// ──────────────────────────────────────────────────────────────
// Helper: recursively copy a directory
// ──────────────────────────────────────────────────────────────
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// ANDROID: Copy Java source files
// ──────────────────────────────────────────────────────────────
function withAndroidJavaFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const pluginDir = path.join(
        projectRoot,
        "plugins",
        "local-tile-server",
        "android"
      );
      const androidPkg = config.android?.package || "com.xnautical.app";
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...androidPkg.split(".")
      );

      fs.mkdirSync(destDir, { recursive: true });

      const javaFiles = [
        "LocalTileServerModule.java",
        "LocalTileServerPackage.java",
      ];
      for (const file of javaFiles) {
        const src = path.join(pluginDir, file);
        const dest = path.join(destDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`[withLocalTileServer] Copied ${file} → ${dest}`);
        } else {
          console.warn(
            `[withLocalTileServer] WARNING: ${file} not found at ${src}`
          );
        }
      }

      return config;
    },
  ]);
}

// ──────────────────────────────────────────────────────────────
// ANDROID: Copy bundled font assets
// ──────────────────────────────────────────────────────────────
function withAndroidFontAssets(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const fontsSource = path.join(
        projectRoot,
        "plugins",
        "local-tile-server",
        "fonts"
      );
      const fontsTarget = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
        "fonts"
      );

      if (fs.existsSync(fontsSource)) {
        copyDirSync(fontsSource, fontsTarget);
        // Count files for logging
        let fileCount = 0;
        const countFiles = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory()) countFiles(path.join(dir, e.name));
            else fileCount++;
          }
        };
        countFiles(fontsTarget);
        console.log(
          `[withLocalTileServer] Copied font assets (${fileCount} files) → ${fontsTarget}`
        );
      } else {
        console.warn(
          `[withLocalTileServer] WARNING: Font assets not found at ${fontsSource}`
        );
      }

      return config;
    },
  ]);
}

// ──────────────────────────────────────────────────────────────
// ANDROID: Add NanoHTTPD dependency to build.gradle
// ──────────────────────────────────────────────────────────────
function withNanoHTTPDDependency(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    // Check if already present
    if (contents.includes("org.nanohttpd:nanohttpd")) {
      console.log(
        "[withLocalTileServer] NanoHTTPD dependency already in build.gradle"
      );
      return config;
    }

    // Strategy: find the dependencies { ... } block and insert before its closing }
    // We find "dependencies {" then match to its closing brace
    const depsStart = contents.indexOf("dependencies {");
    if (depsStart === -1) {
      console.warn(
        "[withLocalTileServer] WARNING: Could not find dependencies block in build.gradle"
      );
      return config;
    }

    // Count braces from the opening { of dependencies to find the matching }
    let braceCount = 0;
    let closingBraceIndex = -1;
    for (let i = contents.indexOf("{", depsStart); i < contents.length; i++) {
      if (contents[i] === "{") braceCount++;
      if (contents[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          closingBraceIndex = i;
          break;
        }
      }
    }

    if (closingBraceIndex === -1) {
      console.warn(
        "[withLocalTileServer] WARNING: Could not find closing brace of dependencies block"
      );
      return config;
    }

    // Insert NanoHTTPD dependency just before the closing } of dependencies
    const nanoHttpdDep =
      "\n    // NanoHTTPD for local tile server (injected by withLocalTileServer plugin)\n" +
      "    implementation 'org.nanohttpd:nanohttpd:2.3.1'\n";

    config.modResults.contents =
      contents.slice(0, closingBraceIndex) +
      nanoHttpdDep +
      contents.slice(closingBraceIndex);

    console.log(
      "[withLocalTileServer] Added NanoHTTPD dependency to build.gradle"
    );
    return config;
  });
}

// ──────────────────────────────────────────────────────────────
// ANDROID: Register LocalTileServerPackage in MainApplication.kt
// ──────────────────────────────────────────────────────────────
function withMainApplicationRegistration(config) {
  return withMainApplication(config, (config) => {
    const contents = config.modResults.contents;

    // Check if already registered
    if (contents.includes("LocalTileServerPackage")) {
      console.log(
        "[withLocalTileServer] LocalTileServerPackage already registered in MainApplication.kt"
      );
      return config;
    }

    // Find the packages.apply block and add our package
    // Look for: PackageList(this).packages.apply {
    const applyPattern =
      /PackageList\(this\)\.packages\.apply\s*\{[^}]*\}/;
    const match = contents.match(applyPattern);

    if (match) {
      const original = match[0];
      const replacement = original.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        `PackageList(this).packages.apply {\n              // LocalTileServer native module (injected by withLocalTileServer plugin)\n              add(LocalTileServerPackage())`
      );
      config.modResults.contents = contents.replace(original, replacement);
      console.log(
        "[withLocalTileServer] Registered LocalTileServerPackage in MainApplication.kt"
      );
    } else {
      console.warn(
        "[withLocalTileServer] WARNING: Could not find PackageList.apply block in MainApplication.kt"
      );
    }

    return config;
  });
}

// ──────────────────────────────────────────────────────────────
// iOS: Copy LocalTileServer.swift to Xcode project
// ──────────────────────────────────────────────────────────────
function withIOSSwiftFile(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const pluginDir = path.join(
        projectRoot,
        "plugins",
        "local-tile-server",
        "ios"
      );
      const projectName = config.modRequest.projectName || "XNautical";
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        projectName
      );

      const srcFile = path.join(pluginDir, "LocalTileServer.swift");
      const destFile = path.join(destDir, "LocalTileServer.swift");

      if (fs.existsSync(srcFile)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(srcFile, destFile);
        console.log(
          `[withLocalTileServer] Copied LocalTileServer.swift → ${destFile}`
        );
      } else {
        console.warn(
          `[withLocalTileServer] WARNING: LocalTileServer.swift not found at ${srcFile}`
        );
      }

      return config;
    },
  ]);
}

// ──────────────────────────────────────────────────────────────
// Main plugin: compose all modifications
// ──────────────────────────────────────────────────────────────
function withLocalTileServer(config) {
  console.log("[withLocalTileServer] Injecting LocalTileServer native module...");

  // Android modifications
  config = withAndroidJavaFiles(config);
  config = withAndroidFontAssets(config);
  config = withNanoHTTPDDependency(config);
  config = withMainApplicationRegistration(config);

  // iOS modifications
  config = withIOSSwiftFile(config);

  console.log("[withLocalTileServer] Plugin setup complete.");
  return config;
}

module.exports = withLocalTileServer;
