"""
LinkedIn REST /v2/ugcPosts text-only (NONE media) payload contract used by Aerostack tools.

Keeps validation and the canonical JSON shape together so dev dead-end sinks and
release checks can reuse the same rules.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

AUTHOR_URN_PATTERN = re.compile(r"^urn:li:(?:person|organization):[^\s]+$")
MAX_COMMENTARY_CHARS = 3000
MAX_AUTHOR_URN_CHARS = 400


def build_linkedin_ugc_payload(author_urn: str, text: str) -> dict[str, Any]:
    """Minimal UGC REST body for published public text-only share."""
    return {
        "author": author_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": text},
                "shareMediaCategory": "NONE",
            },
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
    }


def validate_linkedin_ugc_payload(body: dict[str, Any]) -> tuple[bool, list[str]]:
    """
    Structural validation aligned with Aerostack tooling (not exhaustive vs LinkedIn's full schema).
    """
    errs: list[str] = []

    author = body.get("author")
    if not isinstance(author, str):
        errs.append("author must be a string URN")
    else:
        a = author.strip()
        if (
            len(a) > MAX_AUTHOR_URN_CHARS
            or not AUTHOR_URN_PATTERN.match(a)
        ):
            errs.append(
                "author must be a LinkedIn urn:li:person:... or urn:li:organization:...",
            )

    if body.get("lifecycleState") != "PUBLISHED":
        errs.append("lifecycleState must be PUBLISHED")

    visibility = body.get("visibility")
    if (
        not isinstance(visibility, dict)
        or visibility.get("com.linkedin.ugc.MemberNetworkVisibility") != "PUBLIC"
    ):
        errs.append("visibility must be PUBLIC member network visibility")

    sc = body.get("specificContent")
    if not isinstance(sc, dict):
        errs.append("specificContent must be an object")
    else:
        share = sc.get("com.linkedin.ugc.ShareContent")
        if not isinstance(share, dict):
            errs.append(
                "specificContent.com.linkedin.ugc.ShareContent must be present and an object",
            )
        else:
            if share.get("shareMediaCategory") != "NONE":
                errs.append('shareMediaCategory must be NONE for text-only draft posts')

            commentary = share.get("shareCommentary")
            if not isinstance(commentary, dict):
                errs.append("shareCommentary must be an object with text")
            else:
                txt = commentary.get("text")
                if not isinstance(txt, str) or not txt.strip():
                    errs.append("shareCommentary.text must be a non-empty string")
                elif len(txt) > MAX_COMMENTARY_CHARS:
                    errs.append(
                        f"shareCommentary.text exceeds {MAX_COMMENTARY_CHARS} characters",
                    )

    extra = set(body.keys()) - {
        "author",
        "lifecycleState",
        "specificContent",
        "visibility",
    }
    if extra:
        errs.append(f"unexpected top-level keys (contract drift): {sorted(extra)}")

    return (len(errs) == 0, errs)


def golden_minimal_payload() -> dict[str, Any]:
    """Canonical example used in tests and docs; shape must pass validate_linkedin_ugc_payload."""
    return build_linkedin_ugc_payload(
        "urn:li:person:XXXXXXXX",
        "Example post body for contract tests.\n\n#hashtag",
    )


def load_golden_json_file() -> dict[str, Any]:
    path = Path(__file__).resolve().parent / "fixtures" / "linkedin_ugc_post_minimal.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)
