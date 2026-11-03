import { promises as fs } from 'fs';
import * as path from 'path';
import type { ArtifactInfo } from '../types/index.js';
import { getClaudeProjectDir } from '../utils/claude-projects.js';

/**
 * Claude Code の transcript から、cwd で publish された claude.ai Artifact の一覧を組み立てる。
 *
 * claude.ai には Artifact 一覧を返す公開 API が無いため、Artifact ツールの結果
 * （transcript の `toolUseResult`）に残る url / title を拾って代用する。
 */

interface TranscriptCacheEntry {
  mtimeMs: number;
  size: number;
  artifacts: ArtifactInfo[];
}

// transcript は 1 ファイル数 MB あり、Stop hook のたびに全件読み直すと重いため、
// mtime と size が変わっていないファイルは前回の抽出結果を使い回す
const transcriptCache = new Map<string, TranscriptCacheEntry>();

/** cwd の transcript ディレクトリにある Artifact を、新しい順に返す */
export async function listArtifacts(cwd: string): Promise<ArtifactInfo[]> {
  const projectDir = getClaudeProjectDir(cwd);
  const files = await findJsonlFiles(projectDir);

  const byUrl = new Map<string, ArtifactInfo>();
  for (const filePath of files) {
    const artifacts = await readArtifactsWithCache(filePath);
    for (const artifact of artifacts) {
      mergeLatest(byUrl, artifact);
    }
  }

  const sorted = Array.from(byUrl.values());
  sorted.sort((a, b) => b.updatedAt - a.updatedAt);
  return dedupeByTitle(sorted);
}

/**
 * 同じタイトルの Artifact は最新の 1 件だけ残す（新しい順に並んだ配列を受け取る）。
 * 別セッションで同じ内容を作り直すと URL が変わり、url 単位では同じものが並んでしまうため。
 */
function dedupeByTitle(sortedNewestFirst: ArtifactInfo[]): ArtifactInfo[] {
  const seenTitles = new Set<string>();
  const result: ArtifactInfo[] = [];
  for (const artifact of sortedNewestFirst) {
    if (seenTitles.has(artifact.title)) {
      continue;
    }
    seenTitles.add(artifact.title);
    result.push(artifact);
  }
  return result;
}

/**
 * ディレクトリ配下の .jsonl を再帰で集める。
 * サブエージェントの transcript は `<sessionId>/subagents/*.jsonl` に書かれ、
 * そこで publish された Artifact も一覧に含めたいため再帰する。
 */
async function findJsonlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // セッション未作成のリポジトリではディレクトリ自体が無い
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findJsonlFiles(fullPath);
      for (const nestedPath of nested) {
        files.push(nestedPath);
      }
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readArtifactsWithCache(
  filePath: string
): Promise<ArtifactInfo[]> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return [];
  }

  const cached = transcriptCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.artifacts;
  }

  const artifacts = await extractArtifactsFromTranscript(filePath);
  transcriptCache.set(filePath, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    artifacts,
  });
  return artifacts;
}

/** transcript 1 ファイルから Artifact の publish 結果を抜き出す（url ごとに最新 1 件） */
async function extractArtifactsFromTranscript(
  filePath: string
): Promise<ArtifactInfo[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return [];
  }

  // 大半のファイルは Artifact を含まないので、行分割の前にまとめて弾く
  if (!content.includes('/artifact/')) {
    return [];
  }

  const byUrl = new Map<string, ArtifactInfo>();
  for (const line of content.split('\n')) {
    // 全行を JSON.parse すると重いため、Artifact ツールの結果を含みうる行だけ parse する
    if (!line.includes('"toolUseResult"') || !line.includes('/artifact/')) {
      continue;
    }
    const artifact = parseArtifactLine(line);
    if (artifact) {
      mergeLatest(byUrl, artifact);
    }
  }
  return Array.from(byUrl.values());
}

/**
 * transcript 1 行から、自分が publish / 作成した Artifact を取り出す。
 * quickstart / list / read 等の結果も toolUseResult に入るが、url と title を
 * 両方持つのは publish（更新・type からの新規作成）の結果だけなのでそれで絞る。
 * 他人の Artifact を読んだだけのものを出さないよう、owned が false の行は除く。
 */
function parseArtifactLine(line: string): ArtifactInfo | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(record)) return null;

  const result = record.toolUseResult;
  if (!isObject(result)) return null;

  const { url, title, owned } = result;
  if (typeof url !== 'string' || typeof title !== 'string') return null;
  if (!url.includes('/artifact/')) return null;
  if (owned === false) return null;

  const timestamp = record.timestamp;
  if (typeof timestamp !== 'string') return null;
  const updatedAt = Date.parse(timestamp);
  if (Number.isNaN(updatedAt)) return null;

  return { url, title, updatedAt };
}

/** 同じ url は更新日時が新しい方（タイトルもそちら）を残す */
function mergeLatest(
  byUrl: Map<string, ArtifactInfo>,
  artifact: ArtifactInfo
): void {
  const existing = byUrl.get(artifact.url);
  if (!existing || existing.updatedAt < artifact.updatedAt) {
    byUrl.set(artifact.url, artifact);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
