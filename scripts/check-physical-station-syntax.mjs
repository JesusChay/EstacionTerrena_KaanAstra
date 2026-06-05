import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  path.join(workspaceRoot, 'main.js'),
  ...collectJavaScriptFiles(path.join(workspaceRoot, 'src'))
];

for (const filePath of files) {
  execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
}

console.log(`Checked ${files.length} JavaScript files in physical station`);

function collectJavaScriptFiles(directoryPath) {
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectJavaScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.js')) {
      result.push(fullPath);
    }
  }

  return result;
}
