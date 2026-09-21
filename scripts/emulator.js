/**
 * Starts the Cruzo test phone in the Android emulator and opens the app.
 *
 *   npm run emulator                 # boot Cruzo_Rider_1, install, launch
 *   npm run emulator -- --avd Cruzo_Rider_2
 *   npm run emulator -- --no-install # just boot and launch what is installed
 *
 * Uses the x86_64 build, dist-apk/Cruzo-emulator-x86_64.apk. The phone APK
 * beside it (dist-apk/Cruzo.apk) is ARM-only and
 * crashes on an x86 emulator: React Native's library loader never falls back
 * to Android's ARM translation.
 *
 * The emulator's GPS starts in Gulshan, Dhaka. Move it with
 * `node scripts/sim-ride.js` (see that file).
 */

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!SDK) {
  console.error("ANDROID_HOME is not set.");
  process.exit(1);
}
const ADB = path.join(SDK, "platform-tools", "adb");
const EMULATOR = path.join(SDK, "emulator", "emulator");
const APK = path.join(
  __dirname,
  "..",
  "dist-apk/Cruzo-emulator-x86_64.apk",
);
const PACKAGE = "com.cruzo.app";

const argv = process.argv.slice(2);
const avd = argv.includes("--avd") ? argv[argv.indexOf("--avd") + 1] : "Cruzo_Rider_1";
const install = !argv.includes("--no-install");

const adb = (...args) =>
  execFileSync(ADB, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serial of the running emulator with this AVD name, if any. */
function findSerial() {
  const serials = adb("devices")
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t"))
    .filter(([s, state]) => s.startsWith("emulator-") && state === "device")
    .map(([s]) => s);
  for (const serial of serials) {
    try {
      const name = adb("-s", serial, "emu", "avd", "name").split("\n")[0].trim();
      if (name === avd) return serial;
    } catch {}
  }
  return null;
}

(async () => {
  let serial = findSerial();

  if (!serial) {
    console.log(`Starting ${avd}… (first boot takes 2–4 minutes)`);
    spawn(EMULATOR, ["-avd", avd, "-no-snapshot-save", "-no-boot-anim", "-gpu", "auto"], {
      detached: true,
      stdio: "ignore",
    }).unref();

    for (let i = 0; i < 120 && !serial; i += 1) {
      await sleep(3000);
      serial = findSerial();
    }
    if (!serial) throw new Error("The emulator did not come up. Is the AVD name right?");
  }

  process.stdout.write(`Waiting for ${serial} to finish booting`);
  for (let i = 0; i < 120; i += 1) {
    let booted = "";
    try {
      booted = adb("-s", serial, "shell", "getprop", "sys.boot_completed");
    } catch {}
    if (booted === "1") break;
    process.stdout.write(".");
    await sleep(3000);
  }
  console.log(" ready.");

  if (install) {
    if (!fs.existsSync(APK)) {
      throw new Error(
        `No emulator build at ${APK}.\nBuild it with: cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64\nthen copy app/build/outputs/apk/release/app-release.apk to dist-apk/Cruzo-emulator-x86_64.apk.`,
      );
    }
    console.log("Installing Cruzo…");
    execFileSync(ADB, ["-s", serial, "install", "-r", APK], { stdio: "inherit" });
    for (const permission of [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "RECORD_AUDIO",
      "CAMERA",
    ]) {
      try {
        adb("-s", serial, "shell", "pm", "grant", PACKAGE, `android.permission.${permission}`);
      } catch {}
    }
  }

  // Somewhere real to start from: Gulshan 1, Dhaka.
  adb("-s", serial, "emu", "geo", "fix", "90.4125", "23.7806");
  adb("-s", serial, "shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");

  console.log(`
Cruzo is open on ${serial} (${avd}).

Move the phone:
  node scripts/sim-ride.js --serial ${serial} --from 90.4125,23.7806 --to 90.3954,23.7387
  node scripts/sim-ride.js --serial ${serial} --park 90.4125,23.7806
`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
