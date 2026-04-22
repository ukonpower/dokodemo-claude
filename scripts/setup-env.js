import { copyFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const envFiles = [
  { example: '.env.example', target: '.env' },
];

for (const { example, target } of envFiles) {
  const examplePath = resolve(root, example);
  const targetPath = resolve(root, target);

  if (!existsSync(examplePath)) {
    console.log(`⏭ ${example} が見つかりません。スキップします。`);
    continue;
  }

  if (existsSync(targetPath)) {
    console.log(`✓ ${target} は既に存在します。スキップします。`);
  } else {
    copyFileSync(examplePath, targetPath);
    console.log(`✓ ${example} → ${target} をコピーしました。`);
  }
}
