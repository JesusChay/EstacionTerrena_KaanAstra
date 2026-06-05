import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const layerRules = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  adapters: ['domain', 'application', 'infrastructure', 'adapters']
};

const bannedPackagesByLayer = {
  domain: ['electron', 'serialport', '@serialport/parser-readline', 'xlsx', 'chart.js', 'three', 'fs', 'node:fs', 'path', 'node:path'],
  application: ['electron', 'serialport', '@serialport/parser-readline', 'xlsx', 'chart.js', 'three', 'fs', 'node:fs', 'path', 'node:path']
};

const bannedGlobalsByLayer = {
  domain: [/globalThis\.window/g, /\bwindow\./g, /\bdocument\./g],
  application: [/globalThis\.window/g, /\bwindow\./g, /\bdocument\./g]
};

const components = [
  { name: 'physical-station', root: path.join(workspaceRoot, 'src') },
  { name: 'online-station', root: path.join(workspaceRoot, 'apps', 'web', 'src') },
  { name: 'telemetry-api', root: path.join(workspaceRoot, 'services', 'telemetry-api', 'src') }
];

const violations = [];

const sharedPackagesRoot = path.join(workspaceRoot, 'packages');

  for (const component of components) {
    const files = collectJavaScriptFiles(component.root);
    for (const filePath of files) {
      const source = readFileSync(filePath, 'utf8');
      const relativePath = path.relative(component.root, filePath);
      const layer = relativePath.split(path.sep)[0];
      if (!layerRules[layer]) {
        continue;
      }

      for (const specifier of extractSpecifiers(source)) {
        if (specifier.startsWith('.')) {
          const resolvedImport = resolveImportTarget(path.dirname(filePath), specifier);
          if (!resolvedImport.exists) {
            violations.push(`${component.name}:${relativePath} imports missing file via ${specifier}`);
            continue;
          }

          const resolvedFile = resolvedImport.resolvedPath;
          if (resolvedFile.startsWith(sharedPackagesRoot)) {
            continue;
          }

          if (!resolvedFile.startsWith(component.root)) {
            violations.push(`${component.name}:${relativePath} imports outside its component via ${specifier}`);
            continue;
          }

          const targetRelativePath = path.relative(component.root, resolvedFile);
          const targetLayer = targetRelativePath.split(path.sep)[0];
          if (targetLayer && !layerRules[layer].includes(targetLayer)) {
            violations.push(`${component.name}:${relativePath} (${layer}) cannot import ${targetLayer} via ${specifier}`);
          }
        } else if ((bannedPackagesByLayer[layer] || []).includes(specifier)) {
        violations.push(`${component.name}:${relativePath} (${layer}) imports banned package ${specifier}`);
      }
    }

    for (const pattern of bannedGlobalsByLayer[layer] || []) {
      if (pattern.test(source)) {
        violations.push(`${component.name}:${relativePath} (${layer}) accesses browser globals directly`);
        pattern.lastIndex = 0;
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Architecture boundary violations detected:');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log('Architecture boundary checks passed');

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

function extractSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+[^'";]*?from\s+['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g
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

  const resolvedPath = candidates.find((candidatePath) => exists(candidatePath));
  return {
    exists: Boolean(resolvedPath),
    resolvedPath: resolvedPath || directPath
  };
}

function exists(filePath) {
  try {
    readFileSync(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}
