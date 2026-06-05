import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = collectJavaScriptFiles(rootDir).filter((filePath) => !filePath.includes(`${path.sep}assets${path.sep}`));

for (const filePath of files) {
  execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
  validateRelativeImports(filePath);
}

console.log(`Checked ${files.length} JavaScript files and relative imports in apps/web`);

function collectJavaScriptFiles(directoryPath) {
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

function validateRelativeImports(filePath) {
  const source = readFileSync(filePath, 'utf8');
  for (const specifier of extractSpecifiers(source)) {
    if (!specifier.startsWith('.')) {
      continue;
    }

    const resolved = resolveImportTarget(path.dirname(filePath), specifier);
    if (!resolved) {
      throw new Error(`Missing relative import in ${filePath}: ${specifier}`);
    }
  }
}

function extractSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+[^'";]*?from\s+['"]([^'"]+)['"]/g
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function resolveImportTarget(baseDir, specifier) {
  const directPath = path.resolve(baseDir, specifier);
  const candidates = [
    directPath,
    `${directPath}.js`,
    path.join(directPath, 'index.js')
  ];

  return candidates.find((candidatePath) => exists(candidatePath));
}

function exists(filePath) {
  try {
    readFileSync(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}
