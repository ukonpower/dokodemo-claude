---
name: dokodemo-preview
description: This skill should be used when the user asks to "dokodemo-preview", "preview with dokodemo", "dokodemo-claudeでプレビュー", "dokodemoclaudeでプレビュー", "upload image to dokodemo-claude", "register screenshot", "send image to web interface", "dokodemo-previewでプレビュー", "プレビューしたい", "画像をdokodemo-claudeに登録", "スクリーンショットをアップロード", "画像を送信", or when Claude Code needs to share generated images (test screenshots, diagrams, etc.) with the user through the dokodemo-claude web interface.
---

# dokodemo-preview

Upload images to the dokodemo-claude web interface for preview using REST API.

## Prerequisites

- dokodemo-claude backend running (default: `http://localhost:3200`)
- Valid repository ID (rid) - the active project in dokodemo-claude
- Image file to upload (PNG, JPEG, GIF, WebP)

## Quick Upload Command

```bash
curl -X POST "http://localhost:3200/api/images/{rid}" \
  -F "image=@/path/to/image.png" \
  -F "source=claude" \
  -F "title=Image Title" \
  -F "description=Optional description"
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `image` | Yes | Image file (max 10MB) |
| `source` | No | `user` or `claude` (default: `user`) |
| `title` | No | Display title in UI |
| `description` | No | Additional description |

## Workflow

### Step 1: Get Repository ID

The repository ID (rid) is needed for the API endpoint. Common methods:

1. **From current directory** (recommended for Claude Code):
   ```bash
   RID=$(curl -s "http://localhost:3200/api/repository-id?path=$(pwd)" | jq -r '.rid')
   ```

2. **From repository list**:
   ```bash
   curl -s http://localhost:3200/api/repositories | jq -r '.repositories[0].rid'
   ```

3. **From environment variable** (if set):
   ```bash
   echo $DOKODEMO_RID
   ```

4. **Ask the user** for the current rid shown in dokodemo-claude UI

### Step 2: Upload Image

Use curl to upload with source=claude:

```bash
# Basic upload
curl -X POST "http://localhost:3200/api/images/${RID}" \
  -F "image=@./screenshot.png" \
  -F "source=claude"

# With title and description
curl -X POST "http://localhost:3200/api/images/${RID}" \
  -F "image=@./test-result.png" \
  -F "source=claude" \
  -F "title=E2E Test Result" \
  -F "description=Screenshot after running npm test"
```

### Step 3: Verify Upload

The API returns JSON with upload status:

```json
{
  "success": true,
  "message": "画像をアップロードしました",
  "image": {
    "id": "1706520000000_abc123",
    "filename": "1706520000000_abc123.png",
    "path": "/path/to/images/1706520000000_abc123.png",
    "rid": "repo-id",
    "uploadedAt": 1706520000000,
    "size": 12345,
    "mimeType": "image/png",
    "source": "claude",
    "title": "E2E Test Result",
    "description": "Screenshot after running npm test"
  }
}
```

## Common Use Cases

### Test Screenshots

```bash
# After running E2E tests
curl -X POST "http://localhost:3200/api/images/${RID}" \
  -F "image=@./cypress/screenshots/test.png" \
  -F "source=claude" \
  -F "title=Cypress Test Screenshot"
```

### iOS Simulator Screenshots

```bash
# Take screenshot and upload
xcrun simctl io booted screenshot /tmp/sim-screenshot.png
curl -X POST "http://localhost:3200/api/images/${RID}" \
  -F "image=@/tmp/sim-screenshot.png" \
  -F "source=claude" \
  -F "title=iOS Simulator Screenshot"
```

### Generated Diagrams

```bash
# After generating a diagram
curl -X POST "http://localhost:3200/api/images/${RID}" \
  -F "image=@./diagram.png" \
  -F "source=claude" \
  -F "title=Architecture Diagram" \
  -F "description=System architecture overview"
```

## Error Handling

| Status Code | Meaning |
|-------------|---------|
| 201 | Upload successful |
| 400 | Invalid request (missing file, invalid source, etc.) |
| 404 | Repository not found |

## Tips

- Images uploaded with `source=claude` appear with an orange "Claude" badge in the UI
- Users can filter images by source (All/User/Claude) in the ImageManager
- Maximum file size is 10MB
- Supported formats: PNG, JPEG, GIF, WebP
