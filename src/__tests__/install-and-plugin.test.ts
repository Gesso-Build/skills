import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { runInstall } from "../cli/install.js"
import {
  COMMAND_SOURCE,
  SKILL_SOURCE_DIR,
  readCommandMd,
  readSkillFiles,
} from "../cli/templates.js"

const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
)

describe("the member-facing markdown is the single source of truth", () => {
  it("loader serves the command file verbatim", () => {
    expect(readCommandMd()).toBe(fs.readFileSync(COMMAND_SOURCE, "utf8"))
    expect(readCommandMd()).toMatch(/^---\ndescription:/)
  })

  it("loader serves SKILL.md plus every reference file", () => {
    const files = readSkillFiles()
    const skill = files.find((f) => f.relPath === "SKILL.md")
    expect(skill).toBeTruthy()
    expect(skill!.content).toMatch(/^---\nname: anti-slop\n/)
    expect(skill!.content).toBe(
      fs.readFileSync(path.join(SKILL_SOURCE_DIR, "SKILL.md"), "utf8"),
    )
    // Every file under skills/anti-slop/ ships; nothing is silently dropped.
    const onDisk: string[] = []
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else onDisk.push(path.relative(SKILL_SOURCE_DIR, p))
      }
    }
    walk(SKILL_SOURCE_DIR)
    expect(files.map((f) => f.relPath).sort()).toEqual(onDisk.sort())
  })

  it("plugin manifest is valid, named gesso, at the package root", () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(PKG_ROOT, ".claude-plugin/plugin.json"),
        "utf8",
      ),
    ) as { name: string; version: string }
    expect(manifest.name).toBe("gesso")
    expect(manifest.version).toBeTruthy()
  })

  it("npm files whitelist ships the plugin surfaces", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"),
    ) as { files: string[] }
    for (const required of [".claude-plugin", "commands", "skills"]) {
      expect(pkg.files).toContain(required)
    }
  })
})

describe("runInstall", () => {
  let tmp: string | null = null

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
    tmp = null
  })

  function inTmpCwd<T>(fn: () => T): T {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anti-slop-install-"))
    const prev = process.cwd()
    process.chdir(tmp)
    try {
      return fn()
    } finally {
      process.chdir(prev)
    }
  }

  it("writes the command, the skill, and its references into ./.claude", () => {
    inTmpCwd(() => {
      expect(runInstall(false)).toBe(0)
      const cmd = fs.readFileSync(
        path.join(tmp!, ".claude/commands/gesso-critique.md"),
        "utf8",
      )
      expect(cmd).toBe(readCommandMd())
      for (const { relPath, content } of readSkillFiles()) {
        const installed = fs.readFileSync(
          path.join(tmp!, ".claude/skills/anti-slop", relPath),
          "utf8",
        )
        expect(installed).toBe(content)
      }
    })
  })

  it("never clobbers a locally modified file", () => {
    inTmpCwd(() => {
      const file = path.join(tmp!, ".claude/commands/gesso-critique.md")
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, "my custom command")
      expect(runInstall(false)).toBe(0)
      expect(fs.readFileSync(file, "utf8")).toBe("my custom command")
    })
  })

  it("is idempotent on a second run", () => {
    inTmpCwd(() => {
      runInstall(false)
      expect(runInstall(false)).toBe(0)
      expect(
        fs.readFileSync(
          path.join(tmp!, ".claude/commands/gesso-critique.md"),
          "utf8",
        ),
      ).toBe(readCommandMd())
    })
  })
})
