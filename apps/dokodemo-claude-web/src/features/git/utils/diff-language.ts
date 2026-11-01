// ファイルパスから Prism の言語IDを推定する。判定できなければ null（ハイライトなし）
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
  dart: 'dart', scala: 'scala', hs: 'haskell', ex: 'elixir', exs: 'elixir',
  erl: 'erlang', clj: 'clojure', lua: 'lua', r: 'r', vim: 'vim',
  ps1: 'powershell', proto: 'protobuf', tf: 'hcl', hcl: 'hcl',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
};
const FILENAME_TO_LANG: Record<string, string> = {
  dockerfile: 'docker', makefile: 'makefile', 'cmakelists.txt': 'cmake',
};

export function detectDiffLanguage(filePath: string): string | null {
  const base = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (FILENAME_TO_LANG[base]) return FILENAME_TO_LANG[base];
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  return EXT_TO_LANG[ext] ?? null;
}
