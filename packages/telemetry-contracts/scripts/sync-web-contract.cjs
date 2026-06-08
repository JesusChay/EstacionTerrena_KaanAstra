const fs = require('node:fs');
const path = require('node:path');
const { getBrowserContractSnapshot } = require('../src/index.cjs');

const snapshot = getBrowserContractSnapshot();
const targetPath = path.resolve(__dirname, '..', '..', '..', 'apps', 'web', 'src', 'generated', 'telemetry-contract.js');

const content = `// Generated from packages/telemetry-contracts. Run \`npm run sync:contracts\` after changing the shared contract.\nexport default Object.freeze(${JSON.stringify(snapshot, null, 2)});\n`;

fs.writeFileSync(targetPath, content, 'utf8');
console.log(`Synced browser telemetry contract to ${targetPath}`);
