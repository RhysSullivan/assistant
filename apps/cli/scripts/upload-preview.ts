// Uploads every preview tarball in apps/cli/dist/previews/ to our R2 bucket
// under <SHA>/<filename>. Used by the pkg-pr-new workflow; run locally with
// the same env vars to smoke-test against the real bucket.

import { readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "bun";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
};

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previewsDir = join(cliRoot, "dist/previews");

const s3 = new S3Client({
  accessKeyId: required("S3_ACCESS_KEY_ID"),
  secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  endpoint: required("S3_ENDPOINT"),
  bucket: required("S3_BUCKET"),
  region: "auto",
});

const sha = required("SHA");

const entries = (await readdir(previewsDir)).filter((f) => f.endsWith(".tar.gz"));
if (entries.length === 0) {
  throw new Error(`no preview tarballs found in ${previewsDir}`);
}

for (const name of entries) {
  const key = `${sha}/${name}`;
  const file = Bun.file(join(previewsDir, name));
  const size = file.size;
  console.log(`Uploading ${name} (${(size / 1024 / 1024).toFixed(1)} MiB) → ${key}`);
  await s3.file(key).write(file);
}
