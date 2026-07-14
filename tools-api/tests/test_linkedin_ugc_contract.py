"""Regression: LinkedIn ugcPosts JSON contract stays stable before prod promotion."""

from __future__ import annotations

import sys
from pathlib import Path

# Content Lambda sibling package (not installed as pip module in CI unless path set)
_CONTENT_ROOT = Path(__file__).resolve().parents[1] / "functions" / "content"
sys.path.insert(0, str(_CONTENT_ROOT))

from linkedin_ugc_contract import (  # noqa: E402
    build_linkedin_ugc_payload,
    golden_minimal_payload,
    load_golden_json_file,
    validate_linkedin_ugc_payload,
)


def test_golden_fixture_passes_validator():
    body = load_golden_json_file()
    ok, errs = validate_linkedin_ugc_payload(body)
    assert ok, errs


def test_built_payload_matches_golden_fixture():
    assert build_linkedin_ugc_payload(
        "urn:li:person:XXXXXXXX",
        "Example post body for contract tests.\n\n#hashtag",
    ) == load_golden_json_file()


def test_golden_helper_passes_validator():
    body = golden_minimal_payload()
    ok, errs = validate_linkedin_ugc_payload(body)
    assert ok, errs


def test_invalid_author():
    payload = golden_minimal_payload()
    payload["author"] = "not-a-urn"
    ok, errs = validate_linkedin_ugc_payload(payload)
    assert not ok
    assert any("author" in e.lower() for e in errs)


def test_text_length_cap():
    payload = golden_minimal_payload()
    payload["specificContent"]["com.linkedin.ugc.ShareContent"]["shareCommentary"][
        "text"
    ] = "x" * (3001)
    ok, errs = validate_linkedin_ugc_payload(payload)
    assert not ok
