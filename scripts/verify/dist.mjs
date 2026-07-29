#!/usr/bin/env node
/** Acceptance criterion five: the production build emits a static single page application. Owner: build tooling. */
import { existsSync } from "node:fs";
import { walk, read, verdict } from "./_util.mjs";
const findings = [];
if (!existsSync("dist")) findings.push("dist does not exist, run npm run build");
else {
  if (!existsSync("dist/index.html")) findings.push("dist/index.html is missing");
  const assets = walk("dist");
  const js = assets.filter((f) => f.endsWith(".js"));
  const css = assets.filter((f) => f.endsWith(".css"));
  if (!js.length) findings.push("no javascript asset was emitted");
  if (!css.length) findings.push("no stylesheet asset was emitted");
  if (existsSync("dist/index.html")) {
    const html = read("dist/index.html");
    if (!/<div id="root"/.test(html)) findings.push("the mount point div is missing from the emitted markup");
    if (!/(src|href)="\.\//.test(html)) findings.push("emitted asset paths are not relative, which breaks hosting under a sub path");
  }
  console.log("assets: " + js.length + " script, " + css.length + " stylesheet, " + assets.length + " total files");
}
verdict("production build output is a valid static single page application", findings);
