import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const releasesDir = path.join(distDir, "releases");

function timestampLabel() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const minute = String(now.getUTCMinutes()).padStart(2, "0");
  const second = String(now.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}Z`;
}

async function ensureDistExists() {
  const stat = await fs.stat(distDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error("dist/ was not found. Run npm run build first.");
  }
}

async function readPackageVersion() {
  const packagePath = path.join(rootDir, "package.json");
  const raw = await fs.readFile(packagePath, "utf8");
  const parsed = JSON.parse(raw);
  const version = parsed.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("Unable to read version from package.json");
  }
  return version;
}

async function createZip() {
  await ensureDistExists();
  await fs.mkdir(releasesDir, { recursive: true });

  const version = await readPackageVersion();
  const filename = `session-cookie-bridge-v${version}-${timestampLabel()}.zip`;
  const outputPath = path.join(releasesDir, filename);

  await new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.glob("**/*", {
      cwd: distDir,
      ignore: ["releases/**"]
    });

    archive.finalize().catch(reject);
  });

  return outputPath;
}

try {
  const zipPath = await createZip();
  console.log(`Created zip artifact: ${zipPath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to package zip: ${message}`);
  process.exitCode = 1;
}
