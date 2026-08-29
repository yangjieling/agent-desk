/** Origin bucket for a discovered skill (prompt-visible metadata). */
export type SkillSource =
  | "project-agent-desk"
  | "project-agents"
  | "custom"
  | "user"
  | "bundled"
  | (string & {});

/** Portable skill descriptor — harness truth, not an agent-specific path. */
export interface SkillDescriptor {
  /** Stable id (kebab-case), usually the directory / file stem. */
  id: string;
  /** Display / frontmatter name. */
  name: string;
  /** Short routing description for catalogs / UI. */
  description: string;
  /** Markdown body after frontmatter. */
  instructions: string;
  /** Absolute path to SKILL.md or flat .md. */
  path: string;
  /** Skill bundle root (for --add-dir); null for flat single-file skills. */
  dir: string | null;
  source: SkillSource;
  /** Absolute paths of scripts/ entries, if any. */
  scripts: string[];
  /** CLI-managed built-in (synced from templates/skills). */
  managed?: boolean;
  /** Can be removed via uninstall (user-authored under ~/.agent-desk/skills). */
  removable?: boolean;
  /** Installed / frontmatter version when known. */
  version?: string;
}

/** Catalog row without loading the full body (list APIs). */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  dir: string | null;
  managed?: boolean;
  removable?: boolean;
  version?: string;
}

/** What the runner passes into the coding agent for one skill. */
export interface SkillMount {
  skillId: string;
  /** Prepended to the prompt file at exec time (not stored in DB). */
  promptPrefix: string;
  /** Directories for Claude --add-dir / equivalent. */
  extraSkillDirs: string[];
  /** Resolved descriptor when found; null if only a fallback hint was emitted. */
  descriptor: SkillDescriptor | null;
}

export interface SkillLookupOptions {
  /** Workspace cwd used to find project skill roots (default process.cwd()). */
  cwd?: string;
  /** Extra roots (also from AD_SKILL_DIRS). */
  extraDirs?: string[];
  /** Override bundled templates/skills. */
  bundledDir?: string;
  /** Override ~/.agent-desk/skills. */
  userDir?: string;
}
