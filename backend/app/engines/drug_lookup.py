"""Online drug reference helpers (OpenFDA labels + NIH RxNav when available).

Used by prescription safety analysis to catch dangerous interactions and
label warnings beyond the local heuristic table. No API key required.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

logger = logging.getLogger(__name__)

RXNAV = "https://rxnav.nlm.nih.gov/REST"
OPENFDA = "https://api.fda.gov/drug/label.json"
TIMEOUT = 8

# Phrases that push severity to avoid when seen in published label text
DEADLY_MARKERS = (
    "life-threatening",
    "life threatening",
    "fatal",
    "death",
    "contraindicated",
    "do not use",
    "do not administer",
    "boxed warning",
    "black box",
    "severe bleeding",
    "anaphylaxis",
    "stevens-johnson",
    "toxic epidermal",
    "hepatotoxicity",
    "cardiac arrest",
)

CLASS_ALIASES: dict[str, tuple[str, ...]] = {
    "lisinopril": ("ace inhibitor", "acei", "lisinopril"),
    "enalapril": ("ace inhibitor", "acei", "enalapril"),
    "losartan": ("arb", "angiotensin", "losartan"),
    "metformin": ("metformin", "biguanide"),
    "empagliflozin": ("sglt2", "empagliflozin", "jardiance"),
    "apixaban": ("anticoagulant", "apixaban", "eliquis", "factor xa"),
    "warfarin": ("warfarin", "anticoagulant", "vitamin k antagonist"),
    "ibuprofen": ("nsaid", "ibuprofen", "nonsteroidal"),
    "naproxen": ("nsaid", "naproxen", "nonsteroidal"),
    "furosemide": ("loop diuretic", "furosemide", "lasix"),
    "carvedilol": ("beta blocker", "carvedilol"),
    "gabapentin": ("gabapentin",),
}


def _get_json(url: str) -> Optional[dict[str, Any]]:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "ClearPath-HackGT/1.0 (demo care space)"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        logger.info("Drug lookup miss for %s: %s", url[:140], exc)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Drug lookup error: %s", exc)
        return None


def resolve_rxcui(name: str) -> Optional[str]:
    """Map a medicine name to an RxNorm concept id (best-effort)."""
    q = (name or "").strip()
    if not q:
        return None
    data = _get_json(
        f"{RXNAV}/rxcui.json?{urllib.parse.urlencode({'name': q, 'search': 1})}"
    )
    if not data:
        return None
    ids = (data.get("idGroup") or {}).get("rxnormId") or []
    return str(ids[0]) if ids else None


def _fetch_openfda_label(name: str) -> Optional[dict[str, Any]]:
    q = (name or "").strip()
    if not q:
        return None
    # Prefer labels that include drug_interactions / boxed warnings
    searches = [
        f'openfda.generic_name:"{q}" AND _exists_:drug_interactions',
        f'openfda.generic_name:"{q}" AND _exists_:boxed_warning',
        f'openfda.generic_name:"{q}"',
        f'openfda.brand_name:"{q}" AND _exists_:drug_interactions',
        f'openfda.brand_name:"{q}"',
    ]
    for s in searches:
        data = _get_json(f"{OPENFDA}?search={urllib.parse.quote(s)}&limit=1")
        if data and data.get("results"):
            return data["results"][0]
    return None


def _join_field(label: dict[str, Any], *keys: str) -> str:
    parts: list[str] = []
    for k in keys:
        val = label.get(k)
        if isinstance(val, list):
            parts.extend(str(x) for x in val if x)
        elif isinstance(val, str) and val:
            parts.append(val)
    return " ".join(parts)


def _severity_from_text(text: str, default: str = "caution") -> str:
    low = text.lower()
    if any(m in low for m in DEADLY_MARKERS):
        return "avoid"
    if any(w in low for w in ("serious", "severe", "major", "high risk", "bleeding")):
        return "caution"
    return default


def _mentions_drug(text: str, drug_name: str) -> tuple[bool, str]:
    """Return (matched, matched_term)."""
    low = text.lower()
    name = (drug_name or "").lower().strip()
    if not name or not low:
        return False, ""
    if re.search(rf"\b{re.escape(name)}\b", low):
        return True, name
    for alias in CLASS_ALIASES.get(name, ()):
        if len(alias) < 5:
            continue
        if alias in low:
            return True, alias
    token = name.split()[0]
    if token and len(token) > 5 and re.search(rf"\b{re.escape(token)}\b", low):
        return True, token
    return False, ""


def _snippet_around(text: str, term: str, radius: int = 140) -> str:
    low = text.lower()
    idx = low.find((term or "").lower())
    if idx < 0:
        return re.sub(r"\s+", " ", text[:280]).strip()
    snippet = text[max(0, idx - radius) : idx + radius + len(term)]
    return re.sub(r"\s+", " ", snippet).strip()


def fetch_interactions(proposed: str, active_names: list[str]) -> list[dict[str, Any]]:
    """Detect published interactions via OpenFDA label text (+ RxNav if available)."""
    findings: list[dict[str, Any]] = []

    # Optional RxNav list API (may 404 on some environments — ignore failures)
    resolved: list[tuple[str, str]] = []
    for n in [proposed, *active_names]:
        rxcui = resolve_rxcui(n)
        if rxcui:
            resolved.append((n, rxcui))
    if len(resolved) >= 2:
        cuis = "+".join(c for _, c in resolved)
        data = _get_json(f"{RXNAV}/interaction/list.json?rxcuis={cuis}")
        cui_to_name = {c: n for n, c in resolved}
        for group in (data or {}).get("fullInteractionTypeGroup") or []:
            source = group.get("sourceName") or "RxNav"
            for itype in group.get("fullInteractionType") or []:
                for pair in itype.get("interactionPair") or []:
                    concepts = pair.get("interactionConcept") or []
                    if len(concepts) < 2:
                        continue
                    c0 = str((concepts[0].get("minConceptItem") or {}).get("rxcui") or "")
                    c1 = str((concepts[1].get("minConceptItem") or {}).get("rxcui") or "")
                    n0 = cui_to_name.get(c0) or (concepts[0].get("minConceptItem") or {}).get(
                        "name", "Drug A"
                    )
                    n1 = cui_to_name.get(c1) or (concepts[1].get("minConceptItem") or {}).get(
                        "name", "Drug B"
                    )
                    desc = (pair.get("description") or "").strip()
                    findings.append(
                        {
                            "severity": _severity_from_text(desc, "caution"),
                            "kind": "interaction",
                            "title": f"Published interaction: {n0} + {n1}",
                            "detail": desc[:420] or f"Interaction listed by {source}.",
                            "affects_other_doctors": True,
                            "related_doctors": [],
                            "source": source,
                        }
                    )

    label = _fetch_openfda_label(proposed)
    if not label:
        return findings[:12]

    di_text = _join_field(label, "drug_interactions", "warnings_and_cautions", "warnings")
    prop = (proposed or "").strip()
    seen: set[str] = set()
    for other in active_names:
        if not other or other.lower() == prop.lower():
            continue
        hit, term = _mentions_drug(di_text, other)
        if not hit:
            continue
        key = other.lower()
        if key in seen:
            continue
        seen.add(key)
        snippet = _snippet_around(di_text, term)
        findings.append(
            {
                "severity": _severity_from_text(snippet, "caution"),
                "kind": "interaction",
                "title": f"OpenFDA interaction signal: {prop} + {other}",
                "detail": snippet
                or f"FDA label for {prop} discusses risks involving {other} / related class.",
                "affects_other_doctors": True,
                "related_doctors": [],
                "source": "OpenFDA",
            }
        )

    return findings[:12]


def fetch_label_warnings(name: str, condition_text: str = "") -> list[dict[str, Any]]:
    """Pull boxed warnings / contraindications / serious warnings from OpenFDA."""
    label = _fetch_openfda_label(name)
    if not label:
        return []

    findings: list[dict[str, Any]] = []
    boxed = _join_field(label, "boxed_warning")[:520]
    contra = _join_field(label, "contraindications")[:520]
    warnings = _join_field(label, "warnings_and_cautions", "warnings")[:520]
    cond = (condition_text or "").lower()

    if boxed:
        findings.append(
            {
                "severity": "avoid",
                "kind": "contraindication",
                "title": f"Boxed warning on {name}",
                "detail": boxed,
                "affects_other_doctors": False,
                "related_doctors": [],
                "source": "OpenFDA",
            }
        )

    if contra:
        cond_hit = any(
            w in cond and w in contra.lower()
            for w in (
                "kidney",
                "renal",
                "heart failure",
                "bleeding",
                "ulcer",
                "asthma",
                "liver",
                "pregnancy",
            )
        )
        findings.append(
            {
                "severity": "avoid" if cond_hit else "caution",
                "kind": "contraindication",
                "title": f"Label contraindication for {name}",
                "detail": contra,
                "affects_other_doctors": False,
                "related_doctors": [],
                "source": "OpenFDA",
            }
        )

    if warnings:
        # Condition-specific warning hits
        needles = [
            ("kidney", ("kidney", "renal", "ckd")),
            ("heart failure", ("heart failure", "edema", "fluid")),
            ("bleeding", ("bleed", "ulcer", "gi")),
            ("diabetes", ("diabetes", "glucose", "ketoacidosis")),
        ]
        matched = False
        for label_name, keys in needles:
            if any(k in cond for k in keys) and any(k in warnings.lower() for k in keys):
                findings.append(
                    {
                        "severity": _severity_from_text(warnings, "caution"),
                        "kind": "contraindication",
                        "title": f"Label warning vs {label_name}",
                        "detail": warnings,
                        "affects_other_doctors": False,
                        "related_doctors": [],
                        "source": "OpenFDA",
                    }
                )
                matched = True
                break
        if not matched and any(m in warnings.lower() for m in DEADLY_MARKERS):
            findings.append(
                {
                    "severity": "caution",
                    "kind": "monitoring",
                    "title": f"Serious label warning for {name}",
                    "detail": warnings,
                    "affects_other_doctors": False,
                    "related_doctors": [],
                    "source": "OpenFDA",
                }
            )

    return findings[:5]


def online_safety_check(
    proposed_name: str,
    active_names: list[str],
    condition_text: str = "",
) -> dict[str, Any]:
    """Combine published interactions + OpenFDA warnings for the proposed medicine."""
    interactions = fetch_interactions(proposed_name, active_names)
    labels = fetch_label_warnings(proposed_name, condition_text)
    findings = interactions + labels
    return {
        "findings": findings,
        "checked_names": [proposed_name, *active_names],
        "sources": sorted(
            {str(f.get("source")) for f in findings if f.get("source")}
            | {"OpenFDA", "RxNav"}
        ),
        "online": True,
    }
