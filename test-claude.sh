#!/bin/bash
# Test script to diagnose Claude Code issues

echo "=== Testing Claude Code ==="
echo ""

echo "1. Checking if 'claude' command exists..."
if command -v claude &> /dev/null; then
    echo "   ✓ Claude CLI found at: $(which claude)"
else
    echo "   ✗ Claude CLI not found in PATH"
    echo "   Install it from: https://claude.ai/download"
    exit 1
fi

echo ""
echo "2. Testing simple Claude Code execution..."
OUTPUT=$(mktemp)
ERROR=$(mktemp)

claude --output-format stream-json --verbose --dangerously-skip-permissions "echo hello" > "$OUTPUT" 2> "$ERROR"
EXIT_CODE=$?

echo "   Exit code: $EXIT_CODE"

if [ -s "$ERROR" ]; then
    echo ""
    echo "=== STDERR Output ==="
    cat "$ERROR"
fi

if [ -s "$OUTPUT" ]; then
    echo ""
    echo "=== STDOUT Output (first 500 chars) ==="
    head -c 500 "$OUTPUT"
    echo ""
fi

rm -f "$OUTPUT" "$ERROR"

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ Claude Code is working!"
else
    echo "✗ Claude Code failed with exit code $EXIT_CODE"
    echo ""
    echo "Common fixes:"
    echo "  - Run: claude auth login"
    echo "  - Check: claude auth status"
    echo "  - Verify API keys are configured"
fi
