import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  CRITIQUE_COMMAND_FILENAME,
  SKILL_DIRNAME,
  readCommandMd,
  readSkillFiles,
} from "./templates.js"

/**
 * Install the /gesso-critique slash command + the anti-slop skill (SKILL.md
 * and its references/) into the CURRENT PROJECT's .claude/ (git-reviewable,
 * the default) or, with --global, into ~/.claude/.
 *
 * Overwrite stance: an existing file with different content is left alone
 * and reported (the user may have customized it); identical files are
 * counted as already installed. Nothing outside .claude/ is touched.
 */
export function runInstall(globalScope: boolean): number {
  const base = globalScope
    ? path.join(os.homedir(), ".claude")
    : path.join(process.cwd(), ".claude")

  const targets: Array<{ file: string; content: string; label: string }> = [
    {
      file: path.join(base, "commands", CRITIQUE_COMMAND_FILENAME),
      content: readCommandMd(),
      label: `/${CRITIQUE_COMMAND_FILENAME.replace(/\.md$/, "")} command`,
    },
    ...readSkillFiles().map(({ relPath, content }) => ({
      file: path.join(base, "skills", SKILL_DIRNAME, relPath),
      content,
      label:
        relPath === "SKILL.md"
          ? "anti-slop skill"
          : `anti-slop skill (${relPath})`,
    })),
  ]

  let wrote = 0
  let skipped = 0
  for (const t of targets) {
    if (fs.existsSync(t.file)) {
      const existing = fs.readFileSync(t.file, "utf8")
      if (existing === t.content) {
        process.stdout.write(`ok        ${t.label} (already installed)\n`)
        continue
      }
      process.stdout.write(
        `skipped   ${t.label}: ${t.file} exists with local changes (delete it to reinstall)\n`,
      )
      skipped++
      continue
    }
    fs.mkdirSync(path.dirname(t.file), { recursive: true })
    fs.writeFileSync(t.file, t.content)
    process.stdout.write(`installed ${t.label} -> ${t.file}\n`)
    wrote++
  }

  process.stdout.write(
    [
      "",
      wrote > 0
        ? `Done. Restart Claude Code (or run /help) and try: /gesso-critique <file.html>`
        : skipped > 0
          ? "Nothing installed (existing files were left alone)."
          : "Already up to date.",
      globalScope
        ? ""
        : "Tip: commit .claude/ so your whole team gets the command.",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  )
  return 0
}
