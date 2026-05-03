#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

const args = process.argv.slice(2);
const command = args[0];

const SKILLS_DIR = ".claude/skills";
const CLAUDE_MD = ".claude/CLAUDE.md";
const DEFAULT_OWNER = "silassenadev";
const GITHUB_API = "https://api.github.com";

function help() {
  console.log(`
claude-skills — gerenciador de skills para Claude Code

Uso:
  skills add [repo-url] [--skill <nome>]   Adiciona uma ou mais skills
  skills list [repo-url]                   Lista skills disponíveis
  skills remove <nome>                     Remove uma skill do projeto
  skills ls                                Lista skills instaladas no projeto

Sem repo-url, busca em https://github.com/${DEFAULT_OWNER}

Exemplos:
  skills list
  skills list https://github.com/voce/claude-skills
  skills add
  skills add --skill frontend-design
  skills add https://github.com/voce/claude-skills --skill frontend-design
  skills remove frontend-design
`);
}

function tmpDir() {
  const id = randomBytes(6).toString("hex");
  return join(tmpdir(), `claude-skills-${id}`);
}

function cloneRepo(url, dest) {
  try {
    execSync(`git clone --depth=1 "${url}" "${dest}"`, { stdio: "pipe" });
  } catch {
    console.error(`❌ Erro ao clonar: ${url}`);
    console.error("   Verifique se a URL está correta e o repositório é público.");
    process.exit(1);
  }
}

function findSkills(repoPath) {
  const entries = readdirSync(repoPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .filter((e) => existsSync(join(repoPath, e.name, "SKILL.md")))
    .map((e) => {
      const skillMd = readFileSync(join(repoPath, e.name, "SKILL.md"), "utf8");
      const descMatch = skillMd.match(/^description:\s*(.+)$/m);
      return { name: e.name, description: descMatch ? descMatch[1].trim() : "" };
    });
}

function ensureSkillsDir() {
  if (!existsSync(SKILLS_DIR)) {
    mkdirSync(SKILLS_DIR, { recursive: true });
    console.log(`📁 Criado: ${SKILLS_DIR}`);
  }
}

function updateClaudeMd(skillName, description) {
  const skillPath = `.claude/skills/${skillName}/SKILL.md`;
  const entry = `- \`${skillPath}\` — ${description || skillName}`;

  if (!existsSync(CLAUDE_MD)) {
    mkdirSync(".claude", { recursive: true });
    const content = `# Skills Claude\n\nAntes de executar tarefas complexas, consulte as skills disponíveis:\n\n${entry}\n`;
    import("fs").then(({ writeFileSync }) => writeFileSync(CLAUDE_MD, content));
    console.log(`📝 Criado: ${CLAUDE_MD}`);
    return;
  }

  const content = readFileSync(CLAUDE_MD, "utf8");
  if (content.includes(skillPath)) return;

  const updated = content.trimEnd() + `\n${entry}\n`;
  import("fs").then(({ writeFileSync }) => writeFileSync(CLAUDE_MD, updated));
}

// ── GITHUB API ───────────────────────────────────────────────────────────────

function parseGitHubUrl(url) {
  const profileMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/?$/);
  if (profileMatch) return { type: "profile", owner: profileMatch[1] };

  const repoMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/);
  if (repoMatch) return { type: "repo", owner: repoMatch[1], repo: repoMatch[2] };

  return { type: "url" };
}

async function ghFetch(path) {
  const resp = await fetch(`${GITHUB_API}${path}`, {
    headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "ssdevskills" },
  });
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${path}`);
  return resp.json();
}

async function findSkillsInRepo(owner, repoName) {
  try {
    const contents = await ghFetch(`/repos/${owner}/${repoName}/contents/`);
    if (!Array.isArray(contents)) return [];

    const dirs = contents.filter((f) => f.type === "dir" && !f.name.startsWith("."));
    const found = await Promise.all(
      dirs.map(async (dir) => {
        try {
          const file = await ghFetch(`/repos/${owner}/${repoName}/contents/${dir.name}/SKILL.md`);
          const text = Buffer.from(file.content, "base64").toString("utf8");
          const descMatch = text.match(/^description:\s*(.+)$/m);
          return {
            name: dir.name,
            description: descMatch ? descMatch[1].trim() : "",
            repoName,
            repoUrl: `https://github.com/${owner}/${repoName}`,
          };
        } catch {
          return null;
        }
      })
    );
    return found.filter(Boolean);
  } catch {
    return [];
  }
}

async function discoverSkillsFromOwner(owner) {
  console.log(`🔍 Buscando repositórios de @${owner} ...`);
  let repos;
  try {
    repos = await ghFetch(`/users/${owner}/repos?per_page=100&sort=updated`);
  } catch (e) {
    console.error(`❌ Erro ao buscar repositórios: ${e.message}`);
    process.exit(1);
  }

  const results = await Promise.all(repos.map((r) => findSkillsInRepo(owner, r.name)));
  return results.flat();
}

// ── COMMANDS ─────────────────────────────────────────────────────────────────

async function cmdList(repoUrl) {
  const url = repoUrl || `https://github.com/${DEFAULT_OWNER}`;
  const parsed = parseGitHubUrl(url);

  if (parsed.type === "profile") {
    const skills = await discoverSkillsFromOwner(parsed.owner);
    if (skills.length === 0) {
      console.log("Nenhuma skill encontrada nos repositórios.");
    } else {
      console.log(`\nSkills disponíveis em @${parsed.owner} (${skills.length}):\n`);
      skills.forEach(({ name, description, repoName }) => {
        const desc = description.slice(0, 40).padEnd(42);
        console.log(`  • ${name.padEnd(24)} ${desc} [${repoName}]`);
      });
      console.log();
    }
    return;
  }

  const tmp = tmpDir();
  console.log(`🔍 Buscando skills em ${url} ...`);
  cloneRepo(url, tmp);
  const skills = findSkills(tmp);

  if (skills.length === 0) {
    console.log("Nenhuma skill encontrada neste repositório.");
  } else {
    console.log(`\nSkills disponíveis (${skills.length}):\n`);
    skills.forEach(({ name, description }) => {
      console.log(`  • ${name.padEnd(24)} ${description}`);
    });
    console.log();
  }
  execSync(`rm -rf "${tmp}"`);
}

async function cmdAdd(repoUrl, skillName) {
  const url = repoUrl || `https://github.com/${DEFAULT_OWNER}`;
  const parsed = parseGitHubUrl(url);

  if (parsed.type === "profile") {
    const allSkills = await discoverSkillsFromOwner(parsed.owner);

    if (allSkills.length === 0) {
      console.error("❌ Nenhuma skill encontrada nos repositórios.");
      process.exit(1);
    }

    const toInstall = skillName
      ? allSkills.filter((s) => s.name === skillName)
      : allSkills;

    if (skillName && toInstall.length === 0) {
      console.error(`❌ Skill "${skillName}" não encontrada.`);
      console.log("   Skills disponíveis: " + allSkills.map((s) => s.name).join(", "));
      process.exit(1);
    }

    // Group by repo to clone each repo once
    const byRepo = Object.entries(
      toInstall.reduce((acc, s) => {
        (acc[s.repoUrl] ??= []).push(s);
        return acc;
      }, {})
    );
    ensureSkillsDir();

    for (const [url, skills] of byRepo) {
      const tmp = tmpDir();
      console.log(`📦 Clonando ${url} ...`);
      cloneRepo(url, tmp);
      for (const skill of skills) {
        installSkill(tmp, skill.name, skill.description);
      }
      execSync(`rm -rf "${tmp}"`);
    }

    console.log(`\n🎉 Pronto! Skills instaladas em ${SKILLS_DIR}`);
    return;
  }

  // Original behavior: clone repo directly
  const tmp = tmpDir();
  console.log(`📦 Clonando ${url} ...`);
  cloneRepo(url, tmp);

  const available = findSkills(tmp);
  if (available.length === 0) {
    console.error("❌ Nenhuma skill encontrada neste repositório.");
    execSync(`rm -rf "${tmp}"`);
    process.exit(1);
  }

  const toInstall = skillName ? available.filter((s) => s.name === skillName) : available;
  if (skillName && toInstall.length === 0) {
    console.error(`❌ Skill "${skillName}" não encontrada.`);
    console.log("   Skills disponíveis: " + available.map((s) => s.name).join(", "));
    execSync(`rm -rf "${tmp}"`);
    process.exit(1);
  }

  ensureSkillsDir();
  for (const skill of toInstall) {
    installSkill(tmp, skill.name, skill.description);
  }

  execSync(`rm -rf "${tmp}"`);
  console.log(`\n🎉 Pronto! Skills instaladas em ${SKILLS_DIR}`);
}

function installSkill(repoPath, name, description) {
  const src = join(repoPath, name);
  const dest = join(SKILLS_DIR, name);
  if (existsSync(dest)) {
    console.log(`⚠️  Substituindo skill existente: ${name}`);
    execSync(`rm -rf "${dest}"`);
  }
  cpSync(src, dest, { recursive: true });
  updateClaudeMd(name, description);
  console.log(`✅ Instalada: ${name}`);
}

function cmdRemove(skillName) {
  if (!skillName) {
    console.error("❌ Informe o nome da skill: skills remove <nome>");
    process.exit(1);
  }
  const dest = join(SKILLS_DIR, skillName);
  if (!existsSync(dest)) {
    console.error(`❌ Skill "${skillName}" não está instalada.`);
    process.exit(1);
  }
  execSync(`rm -rf "${dest}"`);
  console.log(`🗑️  Removida: ${skillName}`);
}

function cmdLs() {
  if (!existsSync(SKILLS_DIR)) {
    console.log("Nenhuma skill instalada. Pasta .claude/skills não encontrada.");
    return;
  }
  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && existsSync(join(SKILLS_DIR, e.name, "SKILL.md"))
  );
  if (entries.length === 0) {
    console.log("Nenhuma skill instalada.");
    return;
  }
  console.log(`\nSkills instaladas em ${SKILLS_DIR}:\n`);
  entries.forEach((e) => {
    const skillMd = readFileSync(join(SKILLS_DIR, e.name, "SKILL.md"), "utf8");
    const descMatch = skillMd.match(/^description:\s*(.+)$/m);
    const description = descMatch ? descMatch[1].trim().slice(0, 60) + "..." : "";
    console.log(`  • ${e.name.padEnd(24)} ${description}`);
  });
  console.log();
}

// ── ROUTER ───────────────────────────────────────────────────────────────────

function isRepoUrl(str) {
  return str && (str.startsWith("http://") || str.startsWith("https://") || str.startsWith("git@"));
}

switch (command) {
  case "add": {
    // URL is optional; if first arg looks like a URL use it, otherwise use default
    const repoUrl = isRepoUrl(args[1]) ? args[1] : null;
    const rest = repoUrl ? args.slice(2) : args.slice(1);
    const skillIdx = rest.indexOf("--skill");
    const skillName = skillIdx !== -1 ? rest[skillIdx + 1] : null;
    await cmdAdd(repoUrl, skillName);
    break;
  }
  case "list":
    await cmdList(args[1]);
    break;
  case "remove":
    cmdRemove(args[1]);
    break;
  case "ls":
    cmdLs();
    break;
  default:
    help();
}
