import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

export type SkillFrontmatter = {
  readonly name: string;
  readonly description: string;
  readonly compatibility?: string;
  readonly license?: string;
  readonly allowedTools?: string;
};

export type DistributedSkillFile = {
  readonly path: string;
  readonly uri: string;
  readonly mimeType: string;
  readonly size: number;
  readonly role: "instructions" | "script" | "reference" | "asset" | "other";
};

export type SkillManifest = {
  readonly kind: "agent-skill-distribution";
  readonly publisher: string;
  readonly version: string;
  readonly skill: SkillFrontmatter;
  readonly instructionsUri: string;
  readonly manifestUri: string;
  readonly fileTemplate: string;
  readonly files: readonly DistributedSkillFile[];
};

export type DistributedSkillBundle = {
  readonly publisher: string;
  readonly version: string;
  readonly rootDir: string;
  readonly skill: SkillFrontmatter;
  readonly manifestUri: string;
  readonly instructionsUri: string;
  readonly fileTemplate: string;
  readonly files: readonly DistributedSkillFile[];
  readonly manifest: SkillManifest;
};

const demoPublisher = "demo";
const catalogUri = "skill://catalog/index.json";
const fileTemplate = "skill://demo/{skill}/{version}/{+path}";

const bundleVersions = {
  "postgres-incident-triage": "1.1.0",
  "release-notes-writer": "1.0.0",
} as const;

const skillsDir = fileURLToPath(new URL("../skills", import.meta.url));

const mimeTypeFor = (filePath: string): string => {
  switch (extname(filePath)) {
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown";
    case ".sql":
      return "application/sql";
    case ".ts":
      return "text/typescript";
    default:
      return "text/plain";
  }
};

const roleFor = (filePath: string): DistributedSkillFile["role"] => {
  if (filePath === "SKILL.md") {
    return "instructions";
  }
  if (filePath.startsWith("scripts/")) {
    return "script";
  }
  if (filePath.startsWith("references/")) {
    return "reference";
  }
  if (filePath.startsWith("assets/")) {
    return "asset";
  }
  return "other";
};

const parseFrontmatter = (content: string): SkillFrontmatter => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(content);
  if (!match) {
    throw new Error("Expected SKILL.md to start with YAML frontmatter");
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const entry = /^([A-Za-z0-9-]+):\s*(.+)$/u.exec(trimmed);
    if (!entry) {
      continue;
    }

    fields[entry[1]] = entry[2];
  }

  if (!fields.name || !fields.description) {
    throw new Error("Expected SKILL.md frontmatter to include name and description");
  }

  return {
    name: fields.name,
    description: fields.description,
    compatibility: fields.compatibility,
    license: fields.license,
    allowedTools: fields["allowed-tools"],
  };
};

const collectFiles = async (rootDir: string): Promise<string[]> => {
  const output: string[] = [];

  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      output.push(posix.join(...relative(rootDir, absolutePath).split("\\").filter(Boolean)));
    }
  };

  await visit(rootDir);
  return output;
};

export const getCatalogUri = (): string => catalogUri;

export const getFileTemplate = (): string => fileTemplate;

export const loadDistributedSkillBundles = async (): Promise<readonly DistributedSkillBundle[]> => {
  const bundles = await Promise.all(
    Object.entries(bundleVersions).map(async ([directoryName, version]) => {
      const rootDir = join(skillsDir, directoryName);
      const skillContent = await readFile(join(rootDir, "SKILL.md"), "utf8");
      const skill = parseFrontmatter(skillContent);
      const files = await collectFiles(rootDir);

      const distributedFiles = await Promise.all(
        files.map(async (filePath) => {
          const absolutePath = join(rootDir, filePath);
          const fileStats = await stat(absolutePath);
          return {
            path: filePath,
            uri: `skill://${demoPublisher}/${skill.name}/${version}/${filePath}`,
            mimeType: mimeTypeFor(filePath),
            size: fileStats.size,
            role: roleFor(filePath),
          } satisfies DistributedSkillFile;
        }),
      );

      const manifestUri = `skill://${demoPublisher}/${skill.name}/${version}/manifest.json`;
      const instructionsUri = `skill://${demoPublisher}/${skill.name}/${version}/SKILL.md`;

      const manifest: SkillManifest = {
        kind: "agent-skill-distribution",
        publisher: demoPublisher,
        version,
        skill,
        instructionsUri,
        manifestUri,
        fileTemplate,
        files: distributedFiles,
      };

      return {
        publisher: demoPublisher,
        version,
        rootDir,
        skill,
        manifestUri,
        instructionsUri,
        fileTemplate,
        files: distributedFiles,
        manifest,
      } satisfies DistributedSkillBundle;
    }),
  );

  return bundles.sort((left, right) => left.skill.name.localeCompare(right.skill.name));
};

export const renderCatalog = (bundles: readonly DistributedSkillBundle[]): string =>
  JSON.stringify(
    {
      kind: "agent-skill-catalog",
      distributionMethod: "mcp-resources",
      catalogUri,
      fileTemplate,
      activationGuidance: [
        "Use this catalog for discovery only.",
        "Read a skill manifest next to find the concrete SKILL.md URI.",
        "Load SKILL.md into the model only when the task matches the skill description.",
        "Fetch support files from the manifest on demand.",
      ],
      skills: bundles.map((bundle) => ({
        name: bundle.skill.name,
        description: bundle.skill.description,
        version: bundle.version,
        manifestUri: bundle.manifestUri,
        instructionsUri: bundle.instructionsUri,
      })),
    },
    null,
    2,
  );

export const findBundleByName = (
  bundles: readonly DistributedSkillBundle[],
  skillName: string,
): DistributedSkillBundle | undefined =>
  bundles.find((bundle) => bundle.skill.name === skillName);

export const findBundleFile = (
  bundles: readonly DistributedSkillBundle[],
  skillName: string,
  version: string,
  filePath: string,
): DistributedSkillFile | undefined =>
  bundles
    .find((bundle) => bundle.skill.name === skillName && bundle.version === version)
    ?.files.find((file) => file.path === filePath);

export const readBundleFileText = async (
  bundle: DistributedSkillBundle,
  filePath: string,
): Promise<string> =>
  readFile(join(bundle.rootDir, filePath), "utf8");
