#!/usr/bin/env node
// anti-slop CLI.
//
//   anti-slop check <file.html|dir> [--json]   detect; exit 1 on hits
//   anti-slop fix <file.html> [--write]        apply deterministic fixes
//   anti-slop install [--global]               slash command + skill into .claude/
//
// The check verdict is deliberately binary (pass/slop) with the tells
// listed, so it slots into CI and slash-command workflows.

import * as fs from "node:fs"
import * as path from "node:path"
import { applySlopFixes, runSlopGuard } from "./engine.js"
import { FLAGSHIP_RULES } from "./rules.js"
import { runInstall } from "./cli/install.js"

const VERSION = "0.4.2"

function printUsage(): void {
  process.stdout.write(
    [
      `anti-slop v${VERSION} (by Gesso, https://gesso.build)`,
      "",
      "Usage:",
      "  anti-slop check <file.html|dir> [--json]",
      "      Detect AI-slop tells. Exit 0 = clean, 1 = slop found.",
      "  anti-slop fix <file.html> [--write]",
      "      Apply deterministic fixes. Prints to stdout; --write edits in place.",
      "  anti-slop install [--global]",
      "      Install the /gesso-critique slash command + anti-slop skill into",
      "      this project's .claude/ (or ~/.claude/ with --global).",
      "",
    ].join("\n"),
  )
}

function htmlFiles(target: string): string[] {
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]
  const out: string[] = []
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const p = path.join(target, entry.name)
    if (entry.isDirectory()) out.push(...htmlFiles(p))
    else if (/\.html?$/i.test(entry.name)) out.push(p)
  }
  return out
}

function runCheck(target: string, json: boolean): number {
  const files = htmlFiles(target)
  if (files.length === 0) {
    process.stderr.write(`no .html files found under ${target}\n`)
    return 2
  }
  let slopTotal = 0
  const results = files.map((file) => {
    const html = fs.readFileSync(file, "utf8")
    const check = runSlopGuard(html, {}, FLAGSHIP_RULES)
    slopTotal += check.counts.total
    return { file, ...check }
  })

  if (json) {
    process.stdout.write(JSON.stringify({ results }, null, 2) + "\n")
  } else {
    for (const r of results) {
      const verdict = r.pass ? "PASS" : `SLOP (severity ${r.severity})`
      process.stdout.write(`${r.file}: ${verdict}\n`)
      for (const issue of r.issues) process.stdout.write(`  ${issue}\n`)
    }
    process.stdout.write(
      `\n${files.length} file(s), ${slopTotal} slop occurrence(s).\n`,
    )
  }
  return slopTotal > 0 ? 1 : 0
}

function runFix(target: string, write: boolean): number {
  const html = fs.readFileSync(target, "utf8")
  const result = applySlopFixes(html, {}, FLAGSHIP_RULES)
  if (write) {
    fs.writeFileSync(target, result.html)
    const summary = Object.entries(result.fixes)
      .map(([id, n]) => `${id} x${n}`)
      .join(", ")
    process.stdout.write(
      result.total > 0
        ? `fixed ${result.total} occurrence(s): ${summary}\n`
        : "already clean\n",
    )
  } else {
    process.stdout.write(result.html)
  }
  return 0
}

function main(): number {
  const [, , cmd, ...rest] = process.argv
  if (cmd === "-h" || cmd === "--help" || cmd === "help" || cmd === undefined) {
    printUsage()
    return cmd === undefined ? 2 : 0
  }
  if (cmd === "-v" || cmd === "--version") {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }
  if (cmd === "check") {
    const target = rest.find((a) => !a.startsWith("--"))
    if (!target) {
      process.stderr.write("error: check needs a file or directory\n")
      return 2
    }
    return runCheck(target, rest.includes("--json"))
  }
  if (cmd === "fix") {
    const target = rest.find((a) => !a.startsWith("--"))
    if (!target) {
      process.stderr.write("error: fix needs a file\n")
      return 2
    }
    return runFix(target, rest.includes("--write"))
  }
  if (cmd === "install") {
    return runInstall(rest.includes("--global"))
  }
  process.stderr.write(`error: unknown command '${cmd}'\n\n`)
  printUsage()
  return 2
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(
    `[anti-slop] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
