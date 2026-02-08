/**
 * Expo Config Plugin: withGnssSatellite
 *
 * Automatically injects the GnssSatellite native module during `npx expo prebuild`.
 * This prevents the module from being lost during `prebuild --clean`.
 *
 * What it does:
 *
 * Android:
 *   1. Copies GnssSatelliteModule.java and GnssSatellitePackage.java
 *   2. Registers GnssSatellitePackage in MainApplication.kt
 *   3. Adds location permissions to AndroidManifest.xml
 *
 * iOS:
 *   1. Copies GnssSatelliteTracker.swift to the Xcode project directory
 *   2. Adds location permissions to Info.plist
 */

const {
  withMainApplication,
  withAndroidManifest,
  withInfoPlist,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

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
        "gnss-satellite-tracker",
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
        "GnssSatelliteModule.java",
        "GnssSatellitePackage.java",
      ];
      for (const file of javaFiles) {
        const src = path.join(pluginDir, file);
        const dest = path.join(destDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`[withGnssSatellite] Copied ${file} → ${dest}`);
        } else {
          console.warn(
            `[withGnssSatellite] WARNING: ${file} not found at ${src}`
          );
        }
      }

      return config;
    },
  ]);
}

// ──────────────────────────────────────────────────────────────
// ANDROID: Register GnssSatellitePackage in MainApplication.kt
// ──────────────────────────────────────────────────────────────
function withMainApplicationRegistration(config) {
  return withMainApplication(config, (config) => {
    const contents = config.modResults.contents;

    // Check if already registered
    if (contents.includes("GnssSatellitePackage")) {
      console.log(
        "[withGnssSatellite] GnssSatellitePackage already registered in MainApplication.kt"
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
        `PackageList(this).packages.apply {\n              // GnssSatellite native module (injected by withGnssSatellite plugin)\n              add(GnssSatellitePackage())`
      );
      config.modResults.contents = contents.replace(original, replacement);
      console.log(
        "[withGnssSatellite] Registered GnssSatellitePackage in MainApplication.kt"
      );
    } else {
      console.warn(
        "[withGnssSatellite] WARNING: Could not find PackageList.apply block in MainApplication.kt"
      );
    }

    return config;
  });
}

// ──────────────────────────────────────────────────────────────
// ANDROID: Add location permissions to AndroidManifest.xml
// ──────────────────────────────────────────────────────────────
function withAndroidLocationPermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Add permissions if not present
    if (!manifest["uses-permission"]) {
      manifest["uses-permission"] = [];
    }

    const permissions = [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
    ];

    for (const perm of permissions) {
      const exists = manifest["uses-permission"].some(
        (p) => p.$["android:name"] === perm
      );
      if (!exists) {
        manifest["uses-permission"].push({
          $: { "android:name": perm },
        });
        console.log(`[withGnssSatellite] Added permission: ${perm}`);
      }
    }

    return config;
  });
}

// ──────────────────────────────────────────────────────────────
// iOS: Copy GnssSatelliteTracker.swift to Xcode project
// ──────────────────────────────────────────────────────────────
function withIOSSwiftFile(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const pluginDir = path.join(
        projectRoot,
        "plugins",
        "gnss-satellite-tracker",
        "ios"
      );
      const projectName = config.modRequest.projectName || "XNautical";
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        projectName
      );

      const files = [
        "GnssSatelliteTracker.swift",
        "GnssSatelliteTracker.m" // Objective-C bridging header
      ];
      
      for (const file of files) {
        const srcFile = path.join(pluginDir, file);
        const destFile = path.join(destDir, file);

        if (fs.existsSync(srcFile)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(srcFile, destFile);
          console.log(
            `[withGnssSatellite] Copied ${file} → ${destFile}`
          );
        } else {
          console.warn(
            `[withGnssSatellite] WARNING: ${file} not found at ${srcFile}`
          );
        }
      }

      return config;
    },
  ]);
}

// ──────────────────────────────────────────────────────────────
// iOS: Add location permissions to Info.plist
// ──────────────────────────────────────────────────────────────
function withIOSLocationPermissions(config) {
  return withInfoPlist(config, (config) => {
    const plist = config.modResults;

    // Add location usage descriptions if not present
    const permissions = {
      NSLocationWhenInUseUsageDescription:
        "This app needs access to your location to display real-time GPS satellite information.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "This app needs access to your location to display real-time GPS satellite information.",
    };

    for (const [key, value] of Object.entries(permissions)) {
      if (!plist[key]) {
        plist[key] = value;
        console.log(`[withGnssSatellite] Added iOS permission: ${key}`);
      }
    }

    return config;
  });
}

// ──────────────────────────────────────────────────────────────
// Main plugin: compose all modifications
// ──────────────────────────────────────────────────────────────
function withGnssSatellite(config) {
  console.log("[withGnssSatellite] Injecting GnssSatellite native module...");

  // Android modifications
  config = withAndroidJavaFiles(config);
  config = withMainApplicationRegistration(config);
  config = withAndroidLocationPermissions(config);

  // iOS modifications
  config = withIOSSwiftFile(config);
  config = withIOSLocationPermissions(config);

  console.log("[withGnssSatellite] Plugin setup complete.");
  return config;
}

module.exports = withGnssSatellite;
