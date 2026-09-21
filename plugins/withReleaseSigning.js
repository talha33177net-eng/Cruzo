const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Points the Android release build at Cruzo's own signing key.
 *
 * This is a config plugin rather than a hand edit to `android/app/build.gradle`
 * because that whole directory is generated: `expo prebuild` rewrites it, and
 * `--clean` deletes it outright. Anything applied by hand is lost the next time
 * the native project is regenerated, which is exactly the sort of thing you
 * discover only when a release build silently goes out signed with the debug
 * key.
 *
 * Credentials are read from `credentials/keystore.properties`, which is gitignored
 * and deliberately outside the generated android/ tree.
 * When that file is absent — a fresh clone, or CI without secrets — the build
 * falls back to the debug key so the project still compiles.
 */

const MARKER = "cruzoKeystoreProps";

const LOADER = `
// Cruzo release signing — injected by plugins/withReleaseSigning.js
def cruzoKeystoreProps = new Properties()
def cruzoKeystoreFile = rootProject.file('../credentials/keystore.properties')
if (cruzoKeystoreFile.exists()) {
    cruzoKeystoreProps.load(new FileInputStream(cruzoKeystoreFile))
}

android {`;

const RELEASE_CONFIG = `signingConfigs {
        release {
            if (cruzoKeystoreProps['storeFile']) {
                storeFile file(cruzoKeystoreProps['storeFile'])
                storePassword cruzoKeystoreProps['storePassword']
                keyAlias cruzoKeystoreProps['keyAlias']
                keyPassword cruzoKeystoreProps['keyPassword']
            }
        }
        debug {`;

function applySigning(contents) {
  if (contents.includes(MARKER)) return contents;

  let next = contents;

  // 1. Load the properties file before the android block opens.
  const androidBlock = /^android \{/m;
  if (!androidBlock.test(next)) {
    throw new Error("withReleaseSigning: could not find the android { } block");
  }
  next = next.replace(androidBlock, LOADER.trim());

  // 2. Declare a release signing config alongside the existing debug one.
  const signingConfigs = /signingConfigs \{\s*\n\s*debug \{/;
  if (!signingConfigs.test(next)) {
    throw new Error("withReleaseSigning: could not find signingConfigs { debug { }");
  }
  next = next.replace(signingConfigs, RELEASE_CONFIG);

  // 3. Point the release build type at it, keeping the debug key as a fallback
  //    so a checkout without credentials still builds.
  const releaseSigning = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseSigning.test(next)) {
    throw new Error("withReleaseSigning: could not find the release signingConfig");
  }
  next = next.replace(
    releaseSigning,
    "$1signingConfig cruzoKeystoreProps['storeFile'] ? signingConfigs.release : signingConfigs.debug",
  );

  return next;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error(
        "withReleaseSigning: expected a Groovy build.gradle, got " +
          gradleConfig.modResults.language,
      );
    }
    gradleConfig.modResults.contents = applySigning(gradleConfig.modResults.contents);
    return gradleConfig;
  });
};
