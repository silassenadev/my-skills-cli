#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

const args = process.argv.slice(2);
const command = args[0];

const SKILLS_DIR = ".claude/skills";
const CLAUDE_MD = ".claude/CLAUDE.md";

function help() {
  console.log(`
claude-skills — gerenciador de skills para Claude Code

Uso:
  skills add <repo-url> [--skill <nome>]   Adiciona uma ou mais skills
  skills list [repo-url]                   Lista skills disponíveis no repo
  skills remove <nome>                     Remove uma skill do projeto
  skills ls                                Lista skills instaladas no projeto

Exemplos:
  skills add https://github.com/voce/claude-skills
  skills add https://github.com/voce/claude-skills --skill frontend-design
  skills list https://github.com/voce/claude-skills
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
  // Suporta repositórios onde cada pasta raiz é uma skill (com SKILL.md dentro)
  const entries = readdirSync(repoPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .filter((e) => existsSync(join(repoPath, e.name, "SKILL.md")))
    .map((e) => {
      const skillMd = readFileSync(join(repoPath, e.name, "SKILL.md"), "utf8");
      const descMatch = skillMd.match(/^description:\s*(.+)$/m);
      const description = descMatch ? descMatch[1].trim() : "";
      return { name: e.name, description };
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
  if (content.includes(skillPath)) return; // já existe

  const updated = content.trimEnd() + `\n${entry}\n`;
  import("fs").then(({ writeFileSync }) => writeFileSync(CLAUDE_MD, updated));
}

// ── COMMANDS ────────────────────────────────────────────────────────────────

function cmdList(repoUrl) {
  if (!repoUrl) {
    console.error("❌ Informe a URL do repositório: skills list <repo-url>");
    process.exit(1);
  }

  const tmp = tmpDir();
  console.log(`🔍 Buscando skills em ${repoUrl} ...`);
  cloneRepo(repoUrl, tmp);

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

function cmdAdd(repoUrl, skillName) {
  if (!repoUrl) {
    console.error("❌ Informe a URL do repositório: skills add <repo-url>");
    process.exit(1);
  }

  const tmp = tmpDir();
  console.log(`📦 Clonando ${repoUrl} ...`);
  cloneRepo(repoUrl, tmp);

  const available = findSkills(tmp);

  if (available.length === 0) {
    console.error("❌ Nenhuma skill encontrada neste repositório.");
    execSync(`rm -rf "${tmp}"`);
    process.exit(1);
  }

  // Filtra pela skill pedida (ou instala todas)
  const toInstall = skillName
    ? available.filter((s) => s.name === skillName)
    : available;

  if (skillName && toInstall.length === 0) {
    console.error(`❌ Skill "${skillName}" não encontrada.`);
    console.log("   Skills disponíveis: " + available.map((s) => s.name).join(", "));
    execSync(`rm -rf "${tmp}"`);
    process.exit(1);
  }

  ensureSkillsDir();

  for (const skill of toInstall) {
    const src = join(tmp, skill.name);
    const dest = join(SKILLS_DIR, skill.name);

    if (existsSync(dest)) {
      console.log(`⚠️  Substituindo skill existente: ${skill.name}`);
      execSync(`rm -rf "${dest}"`);
    }

    cpSync(src, dest, { recursive: true });
    updateClaudeMd(skill.name, skill.description);
    console.log(`✅ Instalada: ${skill.name}`);
  }

  execSync(`rm -rf "${tmp}"`);
  console.log(`\n🎉 Pronto! Skills instaladas em ${SKILLS_DIR}`);
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

  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(SKILLS_DIR, e.name, "SKILL.md")));

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

switch (command) {
  case "add": {
    const repoUrl = args[1];
    const skillIdx = args.indexOf("--skill");
    const skillName = skillIdx !== -1 ? args[skillIdx + 1] : null;
    cmdAdd(repoUrl, skillName);
    break;
  }
  case "list":
    cmdList(args[1]);
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
