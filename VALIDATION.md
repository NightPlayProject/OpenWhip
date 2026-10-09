# Validation

Checked on Windows on October 8, 2026, using Node.js 24.15.0, Electron 44.7.0, and Koffi 3.3.2.

`npm test` passes eight checks covering the macro sequence and delays, cancellation before text and before Enter, shortcut release, overlapping triggers, failed input, missing targets, and CLI argument validation. `npm audit --omit=dev` reports zero vulnerabilities for this dependency lockfile.

`npm run test:windows` passes using actual Windows keyboard input and two external native text windows:

- Ctrl+C, exact message text, and exactly one unmodified Enter arrive in the foreground receiver.
- The other receiver remains untouched.
- Unicode text, including an accented character and an emoji, arrives exactly.
- Switching foreground windows during the interruption delay cancels all subsequent text and Enter.
- Both Electron global shortcuts register successfully.
- The real transparent overlay loads and leaves the external receiver focused.
- Ctrl+Alt+Enter sends the full sequence to the external receiver.
- OS mouse movements crack the real animated whip; its renderer IPC triggers the macro and automatic Enter.
- Escape drops the whip; repeated launches keep one instance; `--quit` shuts down cleanly.

The same desktop smoke test supports `--installed` to exercise the globally installed tray app, shortcuts, and whip. Machine-readable source and installation results are saved under `out/validation`, which is excluded from Git and npm packages.

These checks prove the Windows input path, actual overlay, and global shortcut integration with a native text receiver. They do not verify every third-party application, elevated targets, macOS, Linux, or mixed-DPI monitor combinations. The native receiver handles the test messages without executing commands or sending messages to another person.
