/**
 * ルートの.envファイルからVITE_*環境変数を抽出して
 * frontend/.envにコピーするスクリプト
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootEnvPath = path.join(__dirname, '../../.env');
const frontendEnvPath = path.join(__dirname, '../.env');

try {
  // ルートの.envファイルが存在するかチェック
  if (!fs.existsSync(rootEnvPath)) {
    console.log('⚠️  ルートの.envファイルが見つかりません');
    process.exit(0);
  }

  // ルートの.envを読み込み
  const rootEnvContent = fs.readFileSync(rootEnvPath, 'utf-8');

  // VITE_で始まる行だけを抽出
  const viteLines = rootEnvContent.split('\n').filter((line) => {
    const trimmed = line.trim();
    // VITE_で始まる行、またはコメント行を含める
    return (
      trimmed.startsWith('VITE_') ||
      (trimmed.startsWith('#') && line.includes('VITE'))
    );
  });

  // frontend/.envに書き込み
  const frontendEnvContent =
    '# このファイルは自動生成されます (npm run dev時にルートの.envからコピー)\n' +
    '# 直接編集せず、ルートの.envファイルを編集してください\n\n' +
    viteLines.join('\n') +
    '\n';

  fs.writeFileSync(frontendEnvPath, frontendEnvContent, 'utf-8');

  console.log('✓ VITE_* 環境変数をfrontend/.envにコピーしました');

  // コピーされた変数を表示
  const copiedVars = viteLines.filter((line) =>
    line.trim().startsWith('VITE_')
  );
  if (copiedVars.length > 0) {
    console.log('  コピーされた変数:');
    copiedVars.forEach((line) => {
      const [key] = line.split('=');
      console.log(`    - ${key}`);
    });
  }
} catch (error) {
  console.error('❌ エラー:', error.message);
  process.exit(1);
}
