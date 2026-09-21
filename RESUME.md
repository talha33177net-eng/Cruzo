# Where things stand

_Paused 20 Sep 2026, part-way through the release APK build._

## To pick up again

```bash
cd C:\GroupRide\android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Expect **15–25 minutes**. The Gradle cache survived the shutdown, so some of
the work is already done, but the native C++ compile is still ahead.

The result lands at:

```
android/app/build/outputs/apk/release/app-release.apk
```

Copy that to the phone and install it. Android will warn about installing from
an unknown source — that is expected for a sideloaded app.

Keep the laptop awake while it builds. Sleep suspends the compiler mid-task and
can leave a half-written build that needs a clean rebuild.

## Done and verified

- **Supabase backend is live and correct.** Checked against the real project:
  the `parties` table and `end_party` function exist, `host_secret` is
  unreadable (401), direct UPDATE is refused, a wrong secret returns false and
  the right one returns true.
- **Group riding works end to end.** `npm run check:realtime` opens two clients
  against the project, and each rider sees the other, sees movement, and sees a
  departure. This is the app's whole reason for existing and it passes.
- **Credentials are baked into the release bundle** (Supabase, OpenFreeMap
  tiles, Valhalla routing all present).
- **Release signing** uses `credentials/cruzo-release.keystore` via
  `plugins/withReleaseSigning.js`, not the Android debug key.
- **Launcher icon and dark splash** are generated into the native resources.
- Typecheck clean; 78 offline assertions passing.

## Still unverified

- **Nobody has seen this app run on a screen.** No device or emulator has been
  attached at any point. First launch on a real phone is the real test.
- The finished APK has not been checked yet. Before installing, confirm it is
  signed with the Cruzo key rather than the debug key:

  ```bash
  "$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs \
    android/app/build/outputs/apk/release/app-release.apk
  ```

  The owner should read `CN=Cruzo`, not `CN=Android Debug`.

## Back this up

`credentials/` holds the release keystore and its password, and is gitignored.
Lose it and you can never ship an update to anyone who installed this build —
Android identifies an app by its signing key and there is no recovery.

## Leftover

**Re-run `supabase/schema.sql` in the SQL Editor before building** (added 21 Sep
2026). The app now expects the slimmer table and the `touch_party` function;
against the old schema, hosting a party fails. The script upgrades in place and
also deletes the old ended `TESTAB` row.
