---
name: dokodemo-preview
description: This skill should be used when the user asks to "dokodemo-preview", "preview with dokodemo", "dokodemo-claudeでプレビュー", "dokodemoclaudeでプレビュー", "upload image to dokodemo-claude", "register screenshot", "send image to web interface", "dokodemo-previewでプレビュー", "プレビューしたい", "画像をdokodemo-claudeに登録", "スクリーンショットをアップロード", "画像を送信", or when Claude Code needs to share generated images (test screenshots, diagrams, etc.) with the user through the dokodemo-claude web interface.
---

# dokodemo-preview

dokodemo-claude のプレビュー領域に画像 / 動画 / その他ファイルをアップロードする。
アップロードした瞬間に Web UI のアコーディオン（ファイルタブ）へリアルタイム反映される。

## 前提

- dokodemo-claude-api が起動していること（既定ポート: `8001` / `.env` の `DC_API_PORT` で変更）
- 対象リポジトリの `rid`（Repository ID）が取得できること
- アップロードは **raw binary POST**。`multer` 形式ではない

## エンドポイント

```
POST http://localhost:${DC_API_PORT}/api/preview/{rid}
Content-Type: <ファイルのMIME>           # 例: image/png
?filename=<元のファイル名>                # 任意（拡張子の判定に使われる）
&source=claude                           # 任意（既定 'claude'）。'user' or 'claude'
&title=<UI表示タイトル>                  # 任意
&description=<補足説明>                  # 任意

Body: ファイルのバイナリそのもの
```

最大サイズ: 50MB。

## 1. rid を取得

```bash
RID=$(curl -ks "http://localhost:${DC_API_PORT:-8001}/api/repository-id?path=$(pwd)" | jq -r '.rid')
```

すでに `$DOKODEMO_RID` がセットされていればそれを使う。
取得に失敗する場合はユーザーに UI 上の現在のリポジトリ ID を確認する。

## 2. 画像をアップロード

最小:

```bash
curl -X POST \
  "http://localhost:${DC_API_PORT:-8001}/api/preview/${RID}?filename=screenshot.png" \
  -H "Content-Type: image/png" \
  --data-binary @./screenshot.png
```

タイトル/説明付き（URLエンコード必須）:

```bash
TITLE=$(jq -rn --arg v "E2E結果" '$v|@uri')
DESC=$(jq -rn --arg v "npm test 実行後のスクリーンショット" '$v|@uri')

curl -X POST \
  "http://localhost:${DC_API_PORT:-8001}/api/preview/${RID}?filename=test-result.png&source=claude&title=${TITLE}&description=${DESC}" \
  -H "Content-Type: image/png" \
  --data-binary @./test-result.png
```

## 3. 応答

```json
{
  "success": true,
  "message": "ファイルをアップロードしました",
  "file": {
    "id": "1706520000000_abc12345",
    "filename": "1706520000000_abc12345.png",
    "path": "/abs/path/to/uploads/<rid>/1706520000000_abc12345.png",
    "rid": "<rid>",
    "uploadedAt": 1706520000000,
    "size": 12345,
    "mimeType": "image/png",
    "source": "claude",
    "type": "image",
    "title": "E2E結果",
    "description": "npm test 実行後のスクリーンショット"
  }
}
```

成功時の HTTP ステータスは `201`。
アップロード完了とともに Socket.IO の `file-uploaded` イベントがブロードキャストされ、
Web UI のファイルタブが自動更新される。

## ステータスコード

| コード | 意味 |
| --- | --- |
| 201 | アップロード成功 |
| 400 | 不正リクエスト（body無し、rid無し等） |
| 500 | サーバー内部エラー |

## よくある用途

### テスト後のスクリーンショット

```bash
curl -X POST \
  "http://localhost:${DC_API_PORT:-8001}/api/preview/${RID}?filename=cypress.png&source=claude&title=Cypressテスト結果" \
  -H "Content-Type: image/png" \
  --data-binary @./cypress/screenshots/test.png
```

### iOS シミュレータ スクリーンショット

```bash
xcrun simctl io booted screenshot /tmp/sim.png
curl -X POST \
  "http://localhost:${DC_API_PORT:-8001}/api/preview/${RID}?filename=sim.png&source=claude&title=シミュレータ画面" \
  -H "Content-Type: image/png" \
  --data-binary @/tmp/sim.png
```

### 生成した図

```bash
curl -X POST \
  "http://localhost:${DC_API_PORT:-8001}/api/preview/${RID}?filename=arch.png&source=claude&title=アーキテクチャ図" \
  -H "Content-Type: image/png" \
  --data-binary @./diagram.png
```

## メモ

- `source=claude` を付けると Claude 由来のファイルとして metadata に保存される
- 対応 MIME 例: `image/png` `image/jpeg` `image/gif` `image/webp` `video/mp4` `video/webm` `application/pdf` 等
- アップロード対象のフルパスを `--data-binary @<path>` で渡すこと（`-d` だと改行が壊れる）
- `DC_API_PORT` が未定義のときは `8001` をフォールバックに使う
