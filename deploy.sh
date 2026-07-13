#!/bin/bash
# deploy.sh - 将前端文件同步到 RD-Agent 的 static 目录
#
# 用法:
#   ./deploy.sh                          # 默认部署到 ../git_ignore_folder/static/
#   ./deploy.sh /custom/static/path      # 部署到指定路径

set -e

# 目标目录
DEFAULT_TARGET="../git_ignore_folder/static"
TARGET="${1:-$DEFAULT_TARGET}"

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 需要部署的文件
FILES=(
    "multialpha.html"
    "style.css"
    "app.js"
    "socket.io.min.js"
    "App logo.jpg"
)

echo "=========================================="
echo "  MultiAlpha WebUI Deploy"
echo "=========================================="
echo "  Source:  $SCRIPT_DIR"
echo "  Target:  $TARGET"
echo "=========================================="
echo ""

# 检查目标目录
if [ ! -d "$TARGET" ]; then
    echo "Creating target directory: $TARGET"
    mkdir -p "$TARGET"
fi

# 同步文件
for file in "${FILES[@]}"; do
    if [ -f "$SCRIPT_DIR/$file" ]; then
        cp "$SCRIPT_DIR/$file" "$TARGET/"
        echo "  [OK] $file"
    else
        echo "  [SKIP] $file (not found)"
    fi
done

echo ""
echo "Deploy complete! ($TARGET)"
echo ""
echo "Restart the server to pick up changes:"
echo "  cd $(dirname $TARGET)/.. && python webui_main.py"
