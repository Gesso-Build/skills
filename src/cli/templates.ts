// Loader for the member-facing command + skill markdown.
//
// The markdown FILES at the package root are the single source of truth,
// readable word-for-word in the repo exactly as they ship:
//   - commands/critique.md            -> installed as .claude/commands/gesso-critique.md
//                                        (and served by the plugin as /gesso:critique)
//   - skills/anti-slop/SKILL.md       -> installed as .claude/skills/anti-slop/SKILL.md
//   - skills/anti-slop/references/*   -> installed alongside the skill
//
// `anti-slop install` reads them from the installed package at runtime
// (package.json "files" ships commands/ and skills/), and the Claude Code
// plugin serves the same files in place: one copy, nothing generated,
// nothing to drift.

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

// src/cli/ and dist/cli/ are both two levels below the package root.
const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
)

export const CRITIQUE_COMMAND_FILENAME = "gesso-critique.md"
export const SKILL_DIRNAME = "anti-slop"

export const COMMAND_SOURCE = path.join(PKG_ROOT, "commands/critique.md")
export const SKILL_SOURCE_DIR = path.join(PKG_ROOT, "skills", SKILL_DIRNAME)

export function readCommandMd(): string {
  return fs.readFileSync(COMMAND_SOURCE, "utf8")
}

/**
 * Every file of the skill (SKILL.md + references/), as package-root-relative
 * install targets. Sorted for deterministic output.
 */
export function readSkillFiles(): Array<{ relPath: string; content: string }> {
  const out: Array<{ relPath: string; content: string }> = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else out.push({
        relPath: path.relative(SKILL_SOURCE_DIR, p),
        content: fs.readFileSync(p, "utf8"),
      })
    }
  }
  walk(SKILL_SOURCE_DIR)
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}
