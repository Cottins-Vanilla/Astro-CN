#!/usr/bin/env node
// Scans every git-tracked file for a developer machine's filesystem paths (Windows/POSIX home
// dirs) or this machine's own username/home dir, so a vault/AI-agent developer's local paths never
// leak into the repo. Run via `pnpm check:paths` / `node scripts/check-no-personal-paths.mjs`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_PATH = fileURLToPath(import.meta.url);

// Account names that are obviously stand-ins, not a real person: `/home/user/my-vault` in a test
// fixture or `C:\Users\you\...` in docs leaks nothing. Exempting by name rather than by file+line
// on purpose — a line-pinned allowlist silently slides out of alignment the first time anyone
// inserts a line above it, and then fails the build on the wrong hit.
const PLACEHOLDER_ACCOUNTS = new Set(["user", "username", "you", "youruser", "yourname", "me", "example"]);

/** Trailing path segment of a matched home path — the account name, which is the only part that can
 * actually identify someone. */
function accountOf(match) {
  return match.split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

// All three account segments use the same conservative character class. The Windows ones used to
// take everything up to whitespace, which swallowed the punctuation around a path rather than
// stopping at the account name: `C:\Users\you` written inside backticks in a Markdown sentence
// came out as the account "you`," , which is in nobody's allowlist, so documenting the rule
// against hardcoded paths tripped the very check that enforces it.
const ACCOUNT_SEGMENT = "[A-Za-z0-9._-]+";
const patterns = [
  { name: "windows-user-path-backslash", re: new RegExp(`[A-Za-z]:\\\\+Users\\\\+${ACCOUNT_SEGMENT}`, "g") },
  { name: "windows-user-path-forwardslash", re: new RegExp(`[A-Za-z]:/+Users/+${ACCOUNT_SEGMENT}`, "g") },
  { name: "posix-home-path", re: new RegExp(`/(?:home|Users)/${ACCOUNT_SEGMENT}`, "g") },
];

/** Account names that belong to a machine rather than a person: shared, ephemeral, or public, and
 * several of them ordinary English words. The two patterns below are bare substring searches whose
 * hits are treated as real *by construction* (see `isPlaceholder`), which is only sound when the
 * account name identifies somebody. It does not here.
 *
 * This is not hypothetical. GitHub Actions runs as `runner`, so on CI every occurrence of that
 * word was a hard failure: `@vitest/runner` in pnpm-lock.yaml, and the phrase "fuzzy command
 * runner" in docs/OBSIDIAN-GAP-REPORT.md. The check could not pass on GitHub whatever the repo
 * contained, because it had stopped testing for a leaked personal path and started testing for a
 * common noun. Sanitizing the lockfile or exempting `docs/` would have treated the symptom and
 * blinded the check on the files where a real leak matters most. */
const MACHINE_ACCOUNTS = new Set([
  "runner", "root", "admin", "administrator", "build", "builder", "ci", "jenkins",
  "vagrant", "docker", "ubuntu", "dev", "developer", "default", "container",
]);

// CHECK_PATHS_ACCOUNT overrides the detected account, so the rule below can be exercised against a
// name other than the one you happen to be logged in as. `CHECK_PATHS_ACCOUNT=runner pnpm
// check:paths` reproduces what GitHub Actions sees; passing a name that really does occur in the
// tree (`CHECK_PATHS_ACCOUNT=solen`) shows the detection still fires, which is the half of this
// worth re-checking after any edit here.
const username = process.env.CHECK_PATHS_ACCOUNT ?? userInfo().username ?? "";
const home = homedir();
const account = username.toLowerCase();
// Length guard: a two-character account name would match inside ordinary words on every line and
// bury a real hit under thousands of false ones.
const accountIdentifiesAPerson =
  account.length >= 3 && !MACHINE_ACCOUNTS.has(account) && !PLACEHOLDER_ACCOUNTS.has(account);

if (accountIdentifiesAPerson) {
  patterns.push({ name: "current-username", re: new RegExp(escapeRegExp(username), "g") });
  if (home) patterns.push({ name: "current-homedir", re: new RegExp(escapeRegExp(home), "g") });
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlaceholder(patternName, match) {
  // The username/homedir patterns are built from this machine, so a match is real by construction.
  if (patternName === "current-username" || patternName === "current-homedir") return false;
  return PLACEHOLDER_ACCOUNTS.has(accountOf(match));
}

function isBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

const files = execFileSync("git", ["ls-files", "-z"], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "buffer" })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const hits = [];
const reportedAllowlisted = [];

for (const relPath of files) {
  const fullPath = path.resolve(import.meta.dirname, "..", relPath);
  if (fullPath === SELF_PATH) continue; // necessarily contains the very patterns it checks for

  let buf;
  try {
    buf = readFileSync(fullPath);
  } catch {
    continue; // deleted-but-still-staged, submodule gitlink, etc.
  }
  if (buf.length === 0 || isBinary(buf)) continue;

  const text = buf.toString("utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re } of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const matched = m[0];
        if (isPlaceholder(name, matched)) {
          reportedAllowlisted.push(`${relPath}:${i + 1}: ${matched}`);
        } else {
          hits.push(`${relPath}:${i + 1}: ${matched}`);
        }
        if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-length matches looping
      }
    }
  }
}

if (reportedAllowlisted.length > 0) {
  console.log(`Placeholder account names (reported, not failed): ${reportedAllowlisted.length}`);
  for (const h of reportedAllowlisted) console.log(`  ${h}`);
}

if (hits.length > 0) {
  for (const h of hits) console.log(h);
  process.exit(1);
}

console.log(`scanned ${files.length} files, no personal paths`);
