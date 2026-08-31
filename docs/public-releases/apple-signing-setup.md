# Apple signing setup

The canonical macOS release entry point is `scripts/build-macos-release.sh`. It never creates, exports, or stores Apple credentials in the repository.

## One-time local setup

1. Confirm an active Apple Developer Program membership.
2. In Apple’s Developer portal or an Apple-supported Xcode workflow, create/install a **Developer ID Application** certificate. The matching private key must remain in the macOS login Keychain.
3. Verify the identity without exposing private material:

   ```sh
   security find-identity -v -p codesigning
   ```

   The output should include `Developer ID Application: <Name> (<TEAMID>)`.
4. Store notarization credentials in Keychain. The preferred route is an App Store Connect API key; Apple ID plus an app-specific password is also supported:

   ```sh
   xcrun notarytool store-credentials nepal-football-notary
   ```

   Never put passwords, `.p8` contents, private keys, or certificate exports in chat or Git.

## Readiness and release

Optional non-secret environment variables select local entries:

```sh
export APPLE_SIGNING_IDENTITY='Developer ID Application: <Name> (<TEAMID>)'
export APPLE_TEAM_ID='<TEAMID>'
export APPLE_NOTARY_PROFILE='nepal-football-notary'
```

Run the credential gate without compiling:

```sh
bash scripts/build-macos-release.sh --check
```

After it passes, the signed one-command pipeline is:

```sh
bash scripts/build-macos-release.sh --signed
```

It builds both Rust targets, assembles and verifies the universal app, signs nested code before the app, notarizes, staples, validates Gatekeeper, and writes final hashes to `releases/public/0.1.0-rc.2/`. If that directory already contains a candidate, choose the next RC rather than overwrite it. Runtime/save smoke remains a bounded manual check on the exact stapled artifact outside the repository.
