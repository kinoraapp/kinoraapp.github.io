// Asks for the five Mux secrets in the terminal (typing is hidden), checks them against Mux,
// and saves them as Supabase Edge Function secrets. The values are never printed and never
// stored in the project: they go to Supabase through a temporary file that is deleted at once.
//
//   node scripts/set-mux-secrets.mjs [project-ref]           (defaults to the linked project)
//   node scripts/set-mux-secrets.mjs --dry-run               (checks the format only, saves nothing)
import { spawnSync } from "node:child_process";
import { createPrivateKey, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const projectRef =
  args.find((a) => !a.startsWith("--")) ??
  (() => {
    try {
      return readFileSync("supabase/.temp/project-ref", "utf8").trim();
    } catch {
      return "";
    }
  })();

const FIELDS = [
  ["MUX_TOKEN_ID", "Mux access token: Token ID"],
  ["MUX_TOKEN_SECRET", "Mux access token: Secret Key"],
  ["MUX_SIGNING_KEY_ID", "Mux signing key: Key ID"],
  ["MUX_SIGNING_KEY_PRIVATE", "Mux signing key: Base64-encoded Private Key"],
  ["MUX_WEBHOOK_SECRET", "Mux webhook: Signing Secret"],
];

/** Reads one line without echoing it (falls back to plain input when stdin is not a terminal). */
function askHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    process.stdout.write(`${question}: `);
    return new Promise((resolve) => {
      let buffered = "";
      const onData = (chunk) => {
        buffered += chunk;
        const end = buffered.indexOf("\n");
        if (end >= 0) {
          stdin.off("data", onData);
          stdin.pause();
          stdin.unshift(buffered.slice(end + 1));
          const value = buffered.slice(0, end).replace(/\r$/, "");
          process.stdout.write(`(${value.length} characters)\n`);
          resolve(value);
        }
      };
      stdin.setEncoding("utf8");
      stdin.on("data", onData);
      stdin.resume();
    });
  }
  // Label on its own line and a short counter below it, so narrow terminals don't wrap the line
  // being redrawn.
  process.stdout.write(`\n${question}\n  > waiting for paste...`);
  return new Promise((resolve, reject) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    // Show a live character count so it's obvious the paste arrived (and isn't pasted twice).
    const showCount = () => process.stdout.write(`\r\x1b[2K  > ${value.length} characters received`);
    const onData = (chunk) => {
      // Some terminals wrap pasted text in bracketed-paste markers.
      chunk = chunk.replace(/\x1b\[20[01]~/g, "");
      for (const ch of chunk) {
        if (ch === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          if (value.length === 0) continue; // ignore stray newlines before the value
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch === "\u0015" || ch === "\u001b") value = ""; // Ctrl+U or Esc clears the whole entry
        else value += ch;
      }
      showCount();
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

const clean = (v) => v.trim().replace(/^["']|["']$/g, "").trim();

/** If the same text was pasted several times in a row, keep one copy. */
function undoRepeatedPaste(value) {
  for (let parts = 2; parts <= 4; parts++) {
    if (value.length % parts !== 0) continue;
    const one = value.slice(0, value.length / parts);
    if (one.length >= 8 && one.repeat(parts) === value) {
      console.log(`  (It was pasted ${parts} times; using one copy, ${one.length} characters.)`);
      return one;
    }
  }
  return value;
}

function privateKeyProblem(value) {
  try {
    const pem = value.includes("-----BEGIN") ? value : Buffer.from(value, "base64").toString("utf8");
    if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem)) return "it is not a private key (copy the Base64-encoded Private Key)";
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa") return "it is not an RSA key";
    return null;
  } catch {
    return "it could not be read as a private key; copy the whole Base64-encoded value, on one line";
  }
}

async function muxStatus(url, id, secret) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` } });
    return res.status;
  } catch {
    return 0;
  }
}

async function main() {
  if (!projectRef && !dryRun) {
    console.error("No Supabase project. Pass the project ref, e.g. node scripts/set-mux-secrets.mjs abcd1234");
    process.exit(1);
  }
  console.log(dryRun ? "Dry run: checking the format only, nothing is saved." : `Saving Mux secrets to Supabase project ${projectRef}.`);
  console.log("Paste each value ONCE and press Enter. The text stays hidden; you'll see a character count.");
  console.log("Esc clears what you've pasted for the current value. Ctrl+C cancels.\n");

  const values = {};
  for (const [name, label] of FIELDS) {
    for (;;) {
      const value = undoRepeatedPaste(clean(await askHidden(label)));
      let problem = value ? null : "it is empty";
      if (!problem && /\s/.test(value)) problem = "it contains spaces or line breaks";
      if (!problem && name === "MUX_SIGNING_KEY_PRIVATE") problem = privateKeyProblem(value);
      if (!problem && Object.values(values).includes(value)) problem = "it's the same as a value you already entered (copy the right one first)";
      if (!problem && name === "MUX_WEBHOOK_SECRET" && value.length > 200)
        problem = "it's far too long for a webhook signing secret (that looks like the private key)";
      if (!problem) {
        values[name] = value;
        break;
      }
      console.log(`  That doesn't look right: ${problem}. Try again.`);
    }
  }

  if (!dryRun) {
    process.stdout.write("\nChecking the access token with Mux... ");
    const status = await muxStatus("https://api.mux.com/video/v1/assets?limit=1", values.MUX_TOKEN_ID, values.MUX_TOKEN_SECRET);
    if (status === 200) console.log("OK");
    else if (status === 401) return fail("Mux rejected the Token ID / Secret Key. Check you copied both from the same token.");
    else if (status === 403) return fail("The token works but lacks Mux Video Read + Write permission. Create a new token with both.");
    else console.log(`could not check (status ${status || "no connection"}); saving anyway.`);

    process.stdout.write("Checking the signing key ID with Mux... ");
    const keyStatus = await muxStatus(
      `https://api.mux.com/system/v1/signing-keys/${encodeURIComponent(values.MUX_SIGNING_KEY_ID)}`,
      values.MUX_TOKEN_ID,
      values.MUX_TOKEN_SECRET,
    );
    if (keyStatus === 200) console.log("OK");
    else if (keyStatus === 404)
      return fail("Mux has no signing key with that ID in this token's environment. Use a key from the same environment.");
    else console.log("skipped (the token has no System permission; that's fine).");
  }

  const tmp = path.join(os.tmpdir(), `kinora-mux-${randomBytes(8).toString("hex")}.env`);
  try {
    writeFileSync(tmp, FIELDS.map(([name]) => `${name}=${values[name]}`).join("\n") + "\n", { mode: 0o600 });
    if (dryRun) {
      console.log(`\nDry run: all five values look valid. Would save ${FIELDS.map(([n]) => n).join(", ")}.`);
      return;
    }
    console.log("\nSaving to Supabase...");
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const result = spawnSync(`${npx} supabase secrets set --env-file "${tmp}" --project-ref ${projectRef}`, {
      stdio: "inherit",
      shell: true,
    });
    if (result.status !== 0) return fail("Supabase didn't accept the secrets (see the message above).");
    console.log("\nDone: the five Mux secrets are saved. The functions use them right away; no redeploy needed.");
  } finally {
    rmSync(tmp, { force: true });
  }
}

function fail(message) {
  console.error(`\n${message}\nNothing was saved.`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
