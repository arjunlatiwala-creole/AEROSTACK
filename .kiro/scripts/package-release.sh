#!/usr/bin/env bash
# AIDLC -> Peregrine Package & Publish Script
# Local equivalent of the GH Actions workflow for manual publishes.
# Usage: .kiro/scripts/package-release.sh <version>
set -euo pipefail

VERSION="${1:?Usage: $0 <version>}"
MANIFEST="peregrine.json"
[ ! -f "$MANIFEST" ] && echo "Error: $MANIFEST not found" && exit 1

PRODUCT_ID=$(jq -r '.productId' "$MANIFEST")
PROJECT_TYPE=$(jq -r '.projectType' "$MANIFEST")
SLUG=$(jq -r '.slug' "$MANIFEST")
ARTIFACT_PATH=$(jq -r '.artifactPath // "dist"' "$MANIFEST")
DOMAIN=$(jq -r '.domain // "enterprise.io"' "$MANIFEST")

[ "$PRODUCT_ID" = "CHANGE_ME" ] && echo "Error: Update peregrine.json" && exit 1
[ ! -d "$ARTIFACT_PATH" ] && echo "Error: $ARTIFACT_PATH not found" && exit 1

case "$PROJECT_TYPE" in
  landing-page) ZIP=landing-dist.zip ;; showcase) ZIP=showcase-bundle.zip ;;
  onboarding) ZIP=onboarding-dist.zip ;; saas-app) ZIP=frontend-dist.zip ;;
  *) echo "Error: Unknown type: $PROJECT_TYPE" && exit 1 ;;
esac

echo "=== $PRODUCT_ID v$VERSION ($PROJECT_TYPE) ==="
(cd "$ARTIFACT_PATH" && zip -r /tmp/$ZIP . -x .DS_Store .git/* node_modules/* .env*)

cat > /tmp/manifest.json << EOF
{
  "productId": "$PRODUCT_ID",
  "version": "$VERSION",
  "projectType": "$PROJECT_TYPE",
  "slug": "$SLUG",
  "domain": "$DOMAIN",
  "artifact": "$ZIP",
  "publishedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "publishedBy": "manual",
  "repository": "$(git remote get-url origin 2>/dev/null || echo local)",
  "commitSha": "$(git rev-parse HEAD 2>/dev/null || echo none)"
}
EOF

S3=s3://peregrine-templates-dev/products/$PRODUCT_ID/$VERSION
aws s3 cp /tmp/$ZIP $S3/$ZIP --no-cli-pager
aws s3 cp /tmp/manifest.json $S3/manifest.json --no-cli-pager

API=https://k6wq9xbvc8.execute-api.us-east-1.amazonaws.com/dev
curl -sf -X POST "$API/ops/products/$PRODUCT_ID/versions" \
  -H 'Content-Type: application/json' \
  -d "{\"version\":\"$VERSION\",\"projectType\":\"$PROJECT_TYPE\",\"slug\":\"$SLUG\"}" \
  --no-progress-meter || true

if [ "$PROJECT_TYPE" = "landing-page" ]; then
  curl -sf -X POST "$API/ops/landing-pages/$SLUG/deploy" \
    -H 'Content-Type: application/json' \
    -d "{\"source\":\"products/$PRODUCT_ID/$VERSION/$ZIP\",\"version\":\"$VERSION\",\"deployedBy\":\"manual\"}" \
    --no-progress-meter || echo "Deploy failed - register landing page in Peregrine first"
fi

echo "Done: $S3/$ZIP"
[ "$PROJECT_TYPE" = "landing-page" ] && echo "Live: https://$SLUG.$DOMAIN"