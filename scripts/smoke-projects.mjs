/**
 * Smoke: Project CRUD (SQLite bookmark entity).
 * Run: node scripts/smoke-projects.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { newProjectId } = await import(path.join(root, "packages/core/dist/index.js"));
const { openDb } = await import(path.join(root, "packages/db/dist/index.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-proj-"));
const db = openDb(tmp);
const now = Date.now();
const id = newProjectId();
const dir = path.join(tmp, "workspace");
fs.mkdirSync(dir);

db.upsertProject({
  id,
  name: "Demo",
  projectDir: dir,
  repoUrl: "https://github.com/example/demo",
  createdAt: now,
  updatedAt: now,
});

const got = db.getProject(id);
if (!got || got.name !== "Demo" || got.projectDir !== dir) {
  throw new Error(`getProject mismatch: ${JSON.stringify(got)}`);
}
if (!got.repoUrl.includes("example/demo")) throw new Error("repoUrl missing");

const listed = db.listProjects(10);
if (!listed.some((p) => p.id === id)) throw new Error("listProjects missing");

db.upsertProject({
  ...got,
  name: "Demo 2",
  updatedAt: Date.now(),
});
if (db.getProject(id)?.name !== "Demo 2") throw new Error("update failed");

if (!db.deleteProject(id)) throw new Error("delete failed");
if (db.getProject(id)) throw new Error("still present after delete");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("smoke-projects ok");
