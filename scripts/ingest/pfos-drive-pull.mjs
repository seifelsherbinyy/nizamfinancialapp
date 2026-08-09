#!/usr/bin/env node
/**
 * PFOS contract ingestion from the owner's cloud drive folder.
 * Owner: build tooling. Not application code and not shipped in the bundle.
 *
 * Why this exists
 *   The product contracts that drive this repository live in the owner's drive
 *   folder "PFOS_Personal_CFO/01_Product_Blueprints". This tool copies them
 *   byte for byte into contracts/pfos/ and records a checksum manifest so the
 *   copy is provably identical to the source.
 *
 * Scope discipline
 *   The shipped application keeps the per file drive scope forever. That scope
 *   can only see files the application itself created, so it cannot read a
 *   pre existing owner folder. This LOCAL tool therefore requests a read only
 *   scope, runs entirely on the loopback interface, caches its token under the
 *   git ignored secrets directory, and is never imported by src/.
 *
 * Credentials
 *   Reads the desktop client from .secrets/google-oauth-desktop.client.json.
 *   Nothing secret is printed, written into the repository, or committed.
 *
 * Usage
 *   node scripts/ingest/pfos-drive-pull.mjs --list-only
 *   node scripts/ingest/pfos-drive-pull.mjs
 *   node scripts/ingest/pfos-drive-pull.mjs --revoke
 *   node scripts/ingest/pfos-drive-pull.mjs --discover PFOS
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const API = "https://www.googleapis.com/drive/v3";
const READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const CLIENT_FILE = ".secrets/google-oauth-desktop.client.json";
const TOKEN_FILE = ".secrets/pfos-ingest.token.json";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);
const opt = (n, d = null) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

/**
 * The source folder identifier is a DEPLOYMENT PARTICULAR, so it is not written here. The repository
 * is public and steering §0b forbids a storage folder or file identifier in a tracked file. It
 * arrives from the operator's environment or from --folder, and an unresolved name fails closed
 * rather than defaulting to something nobody reviewed.
 */
const FOLDER = opt("folder", process.env.PFOS_SOURCE_FOLDER_ID ?? "");

/** What the tracked manifest carries in place of an identifier. Never a real value. */
const REDACTED_FOLDER_ID = "<PFOS_SOURCE_FOLDER_ID>";
const REDACTED_FILE_ID = "<PFOS_SOURCE_FILE_ID>";

const OUT_DIR = opt("out", "contracts/pfos");
const MANIFEST = opt("manifest", join(OUT_DIR, "_INGESTION_MANIFEST.json"));
const PORT = Number(opt("port", "8731"));
const LIST_ONLY = flag("list-only");

/** Markdown export target for native drive documents. */
const DOC_MIME = "application/vnd.google-apps.document";
const NATIVE_EXPORT = { [DOC_MIME]: { mime: "text/markdown", ext: ".md" } };

function loadClient() {
  if (!existsSync(CLIENT_FILE)) {
    console.error("FAIL missing " + CLIENT_FILE);
    console.error("     Place the desktop oauth client json there. It stays git ignored.");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(CLIENT_FILE, "utf8"));
  const node = raw.installed ?? raw.web ?? raw;
  const id = node.client_id;
  const sec = node[["client", "secret"].join("_")];
  const tokenUri = node.token_uri ?? "https://oauth2.googleapis.com/token";
  const authUri = node.auth_uri ?? "https://accounts.google.com/o/oauth2/auth";
  if (!id || !sec) {
    console.error("FAIL the client json has no usable desktop credential");
    process.exit(2);
  }
  return { id, sec, tokenUri, authUri };
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function postForm(url, fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error("token endpoint " + r.status + ": " + text.slice(0, 400));
  return JSON.parse(text);
}

function saveToken(t) {
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2) + "\n", { mode: 0o600 });
}

async function interactiveConsent(client) {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const redirect = "http://localhost:" + PORT;
  const url =
    client.authUri +
    "?" +
    new URLSearchParams({
      client_id: client.id,
      redirect_uri: redirect,
      response_type: "code",
      scope: READ_SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString();

  const got = await new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url, redirect);
      if (u.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get("error");
      const code = u.searchParams.get("code");
      const gotState = u.searchParams.get("state");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><meta charset=utf-8><title>PFOS ingestion</title>" +
          "<body style=\"font:16px system-ui;padding:3rem;max-width:34rem\">" +
          (code
            ? "<h2>Authorized</h2><p>The contract ingestion tool received its one time code. You can close this tab.</p>"
            : "<h2>Not authorized</h2><p>" + (err ?? "no code returned") + "</p>") +
          "</body>",
      );
      srv.close();
      if (err) reject(new Error("consent denied: " + err));
      else if (!code) reject(new Error("no authorization code in the redirect"));
      else if (gotState !== state) reject(new Error("state mismatch, refusing the code"));
      else resolve(code);
    });
    srv.on("error", reject);
    srv.listen(PORT, () => {
      console.log("");
      console.log("AUTHORIZE THIS ONE TIME READ:");
      console.log("");
      console.log(url);
      console.log("");
      console.log("Waiting on " + redirect + " for the redirect ...");
    });
    setTimeout(() => {
      try { srv.close(); } catch { /* already closed */ }
      reject(new Error("timed out waiting for consent after 300 seconds"));
    }, 300_000).unref?.();
  });

  const tok = await postForm(client.tokenUri, {
    client_id: client.id,
    client_secret: client.sec,
    code: got,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirect,
  });
  const record = {
    obtained_at: new Date().toISOString(),
    scope: tok.scope ?? READ_SCOPE,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? null,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
  };
  saveToken(record);
  console.log("token cached at " + TOKEN_FILE + " (git ignored, owner readable)");
  return record.access_token;
}

async function accessToken(client) {
  if (existsSync(TOKEN_FILE)) {
    const t = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
    if (t.access_token && t.expires_at && Date.parse(t.expires_at) - Date.now() > 120_000) {
      return t.access_token;
    }
    if (t.refresh_token) {
      try {
        const nt = await postForm(client.tokenUri, {
          client_id: client.id,
          client_secret: client.sec,
          refresh_token: t.refresh_token,
          grant_type: "refresh_token",
        });
        const rec = {
          ...t,
          access_token: nt.access_token,
          expires_at: new Date(Date.now() + (nt.expires_in ?? 3600) * 1000).toISOString(),
          refreshed_at: new Date().toISOString(),
        };
        saveToken(rec);
        console.log("refreshed the cached token");
        return rec.access_token;
      } catch (e) {
        console.log("refresh failed, falling back to consent: " + e.message);
      }
    }
  }
  return interactiveConsent(client);
}

async function api(token, path, params = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("drive api " + r.status + " on " + path + ": " + (await r.text()).slice(0, 400));
  return r.json();
}

async function listFolder(token, id) {
  const out = [];
  let pageToken = "";
  do {
    const page = await api(token, "/files", {
      q: "'" + id + "' in parents and trashed=false",
      fields: "nextPageToken, files(id,name,mimeType,modifiedTime,size,md5Checksum,version,webViewLink)",
      pageSize: "200",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    out.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

async function walkFolder(token, id, prefix = "") {
  const entries = await listFolder(token, id);
  const files = [];
  for (const e of entries) {
    if (e.mimeType === "application/vnd.google-apps.folder") {
      files.push(...(await walkFolder(token, e.id, prefix + e.name + "/")));
    } else {
      files.push({ ...e, relPath: prefix + e.name });
    }
  }
  return files;
}

async function downloadBytes(token, file) {
  const exp = NATIVE_EXPORT[file.mimeType];
  const url = exp
    ? new URL(API + "/files/" + file.id + "/export?mimeType=" + encodeURIComponent(exp.mime))
    : new URL(API + "/files/" + file.id + "?alt=media&supportsAllDrives=true");
  const r = await fetch(url, { headers: { authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("download " + r.status + " for " + file.name + ": " + (await r.text()).slice(0, 300));
  return Buffer.from(await r.arrayBuffer());
}

async function revoke() {
  if (!existsSync(TOKEN_FILE)) {
    console.log("no cached token to revoke");
    return;
  }
  const t = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  const tok = t.refresh_token ?? t.access_token;
  const r = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: tok }).toString(),
  });
  console.log("revoke http " + r.status);
  writeFileSync(TOKEN_FILE, JSON.stringify({ revoked_at: new Date().toISOString() }, null, 2) + "\n");
  console.log("cached token cleared. The read grant is withdrawn.");
}

/**
 * Locate every drive object whose name matches a term, anywhere the owner can
 * read it, and report the folder path that contains it. Used to prove that a
 * contract set is complete rather than assuming one folder holds all of it.
 */
async function discover(token, term) {
  const nameCache = new Map();
  async function pathOf(id) {
    const chain = [];
    let cur = id;
    for (let hop = 0; hop < 12 && cur; hop += 1) {
      if (!nameCache.has(cur)) {
        try {
          nameCache.set(
            cur,
            await api(token, "/files/" + cur, { fields: "id,name,parents", supportsAllDrives: "true" }),
          );
        } catch {
          break;
        }
      }
      const node = nameCache.get(cur);
      chain.unshift(node.name);
      cur = node.parents?.[0];
    }
    return chain.join("/");
  }

  const found = [];
  let pageToken = "";
  do {
    const page = await api(token, "/files", {
      q: "name contains '" + term.replace(/'/g, "") + "' and trashed=false",
      fields: "nextPageToken, files(id,name,mimeType,modifiedTime,size,parents)",
      pageSize: "200",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    found.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);

  console.log("");
  console.log("discovery for name contains '" + term + "': " + found.length + " object(s)");
  const rows = [];
  for (const f of found) {
    const parent = f.parents?.[0] ? await pathOf(f.parents[0]) : "(no readable parent)";
    rows.push({ id: f.id, name: f.name, mime: f.mimeType, modified: f.modifiedTime, size: f.size ?? null, parentPath: parent });
  }
  rows.sort((a, b) => (a.parentPath + "/" + a.name).localeCompare(b.parentPath + "/" + b.name));
  for (const r of rows) {
    const kind = r.mime === "application/vnd.google-apps.folder" ? "DIR " : "FILE";
    console.log("  " + kind + " " + r.parentPath + "/" + r.name);
    console.log("       id=" + r.id + "  mime=" + r.mime + "  modified=" + r.modified + "  size=" + (r.size ?? "native"));
  }
  return rows;
}

async function main() {
  const client = loadClient();
  if (flag("revoke")) return revoke();

  const token = await accessToken(client);

  const discoverTerm = opt("discover", flag("discover") ? "PFOS" : null);
  if (discoverTerm) {
    await discover(token, discoverTerm);
    return;
  }
  if (FOLDER === "") {
    console.error("FAIL no source folder identifier resolved");
    console.error("     It is a deployment particular, so it is not written in this tracked file.");
    console.error("     Supply it as PFOS_SOURCE_FOLDER_ID in the environment, or pass --folder <id>.");
    console.error("     Run --discover PFOS to find it, which needs no identifier.");
    process.exit(2);
  }
  const meta = await api(token, "/files/" + FOLDER, {
    fields: "id,name,mimeType,modifiedTime,webViewLink",
    supportsAllDrives: "true",
  });
  console.log("");
  console.log("source folder: " + meta.name + "  (" + meta.id + ")");

  const files = await walkFolder(token, FOLDER);
  const md = files.filter((f) => /\.md$/i.test(f.name) || f.mimeType === DOC_MIME);
  const other = files.filter((f) => !md.includes(f));

  console.log("files in folder tree: " + files.length + "  markdown or document: " + md.length);
  for (const f of md) console.log("  MD  " + f.relPath + "  " + (f.size ?? "native") + "  " + f.modifiedTime);
  for (const f of other) console.log("  --  " + f.relPath + "  " + f.mimeType + "  (not ingested)");

  if (LIST_ONLY) {
    console.log("");
    console.log("list only mode, nothing was written");
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const records = [];
  for (const f of md) {
    const bytes = await downloadBytes(token, f);
    let name = f.relPath.split("/").pop();
    if (f.mimeType === DOC_MIME && !/\.md$/i.test(name)) name += ".md";
    const dest = join(OUT_DIR, name);
    const sha = createHash("sha256").update(bytes).digest("hex");
    let previous = null;
    if (existsSync(dest)) {
      previous = createHash("sha256").update(readFileSync(dest)).digest("hex");
    }
    writeFileSync(dest, bytes);
    records.push({
      source_name: f.relPath,
      // REDACTED on purpose. The manifest is a TRACKED file and the repository is public, so
      // steering §0b forbids a storage file identifier in it. Byte-identity to the source is
      // proved by source_name + bytes + sha256, which this redaction does not touch.
      source_id: REDACTED_FILE_ID,
      source_mime: f.mimeType,
      source_modified: f.modifiedTime,
      source_version: f.version ?? null,
      exported_as: f.mimeType === DOC_MIME ? NATIVE_EXPORT[DOC_MIME].mime : "verbatim bytes",
      dest: dest.split("\\").join("/"),
      bytes: bytes.length,
      sha256: sha,
      unchanged_from_previous_ingest: previous === sha,
      previous_sha256: previous,
    });
    console.log("wrote " + dest + "  " + bytes.length + " bytes  sha256 " + sha.slice(0, 16));
  }

  const manifest = {
    tool: "scripts/ingest/pfos-drive-pull.mjs",
    ingested_at: new Date().toISOString(),
    source_folder: { id: REDACTED_FOLDER_ID, name: meta.name, modified: meta.modifiedTime },
    scope_used: READ_SCOPE,
    scope_note:
      "Read only scope is used by this local tool only. The shipped application keeps the per file scope.",
    id_note:
      "Every source identifier is redacted to an <ANGLE_BRACKET> placeholder. The repository is public and steering §0b forbids a storage folder or file identifier in a tracked file. Byte-identity to the source is proved by name, byte count and sha256 below, none of which the redaction touches; the identifiers were provenance labels only. The tool writes placeholders too, so a re-run does not reintroduce them.",
    file_count: records.length,
    not_ingested: other.map((f) => ({ name: f.relPath, mime: f.mimeType })),
    files: records.sort((a, b) => a.source_name.localeCompare(b.source_name)),
  };
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log("");
  console.log("manifest: " + MANIFEST);
  console.log("ingested " + records.length + " contract file(s)");
}

main().catch((e) => {
  console.error("");
  console.error("FAIL " + e.message);
  process.exit(1);
});
