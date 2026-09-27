"""openFDA medicine profiles for the doctor info card and Ava's medicine answers.

One profile combines the FDA label (what it treats, dosing, warnings, patient info),
the NDC directory (products and manufacturers) and FAERS adverse event reports.
No API key required; results are cached in memory.
"""
from __future__ import annotations

import re
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from app.engines.drug_lookup import CLASS_ALIASES, _get_json

LABEL = "https://api.fda.gov/drug/label.json"
NDC = "https://api.fda.gov/drug/ndc.json"
EVENT = "https://api.fda.gov/drug/event.json"
CACHE_TTL_S = 6 * 60 * 60

FETCH_TIMEOUT_S = 15

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_inflight: set[str] = set()
_lock = threading.Lock()
# Separate pools: a prefetch waits on fetches, so they must never share workers.
_fetch_pool = ThreadPoolExecutor(max_workers=9, thread_name_prefix="fda-fetch")
_warm_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="fda-warm")

BRAND_TO_GENERIC = {
    "jardiance": "empagliflozin",
    "eliquis": "apixaban",
    "coreg": "carvedilol",
    "lasix": "furosemide",
    "neurontin": "gabapentin",
    "zestril": "lisinopril",
    "prinivil": "lisinopril",
    "glucophage": "metformin",
    "glucotrol": "glipizide",
    "coumadin": "warfarin",
    "advil": "ibuprofen",
    "motrin": "ibuprofen",
    "aleve": "naproxen",
}

MED_QUESTION_WORDS = (
    "medicine", "medication", "pill", "tablet", "drug", "dose", "side effect",
    "side-effect", "prescription", "refill", "take it", "taking it", "interact",
    "alcohol", "grapefruit", "missed", "skip",
)


def _query_name(name: str) -> str:
    q = re.sub(r"[^a-z0-9 \-]", " ", (name or "").lower()).strip()
    q = re.sub(r"\s+(er|xr|sr|hcl|hydrochloride|sodium|potassium)$", "", q).strip()
    return BRAND_TO_GENERIC.get(q, q)


def _clean(text: str, limit: int = 600) -> str:
    """Label sections arrive as long uppercase-headed blobs with cross references."""
    t = re.sub(r"\s+", " ", (text or "").replace("\ufffd", " ").replace("•", " ")).strip()
    t = re.sub(
        r"^(\d+(\.\d+)*\s+)?(BOXED WARNING|INDICATIONS (AND|&) USAGE|DOSAGE (AND|&) ADMINISTRATION|"
        r"WARNINGS AND PRECAUTIONS|WARNINGS|PRECAUTIONS|ADVERSE REACTIONS|DRUG INTERACTIONS|"
        r"INFORMATION FOR PATIENTS|PATIENT COUNSELING INFORMATION)\s*:?\s*",
        "",
        t,
    ).strip()
    t = re.sub(r"See full prescribing information for complete boxed warning\.?", "", t, flags=re.I)
    t = re.sub(r"Table \d+ (presents|lists|shows|describes)[^.]*\.\s*", "", t)
    t = re.sub(r"Table \d+:[^.]{0,120}?\bwith [A-Z][A-Za-z]+\b\s*", "", t)
    t = re.sub(r"(^|\s)(\d{1,2}\.\s+)+(?=[A-Z])", r"\1", t)
    t = re.sub(r"^(WARNING:[^a-z]{3,}?)\s+\1\s+", r"\1 ", t)
    t = re.sub(r"\(\s*\d+(\.\d+)*(\s*,\s*\d+(\.\d+)*)*\s*\)", "", t)
    t = re.sub(r"\[\s*see [^\]]*\]", "", t, flags=re.I)
    t = re.sub(r"\s+([,.;:])", r"\1", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    if len(t) <= limit:
        return t
    cut = t[:limit]
    end = cut.rfind(". ")
    return (cut[: end + 1] if end > limit * 0.5 else cut.rstrip() + "…").strip()


def _field(label: dict[str, Any], *keys: str, limit: int = 600) -> str:
    for k in keys:
        val = label.get(k)
        if isinstance(val, list) and val:
            text = " ".join(str(x) for x in val if x)
        elif isinstance(val, str):
            text = val
        else:
            continue
        cleaned = _clean(text, limit)
        if cleaned:
            return cleaned
    return ""


def _single_ingredient(generic: str, q: str) -> bool:
    g = generic.lower()
    return q in g and " and " not in g and "/" not in g and "," not in g


def _fetch_label(q: str) -> Optional[dict[str, Any]]:
    """Prefer the single-ingredient, brand-name label over combination products."""
    for s in (
        f'openfda.generic_name:"{q}" AND _exists_:indications_and_usage',
        f'openfda.brand_name:"{q}"',
    ):
        data = _get_json(f"{LABEL}?search={urllib.parse.quote(s)}&limit=25")
        rows = (data or {}).get("results") or []
        if not rows:
            continue

        def score(row: dict[str, Any]) -> tuple:
            ofda = row.get("openfda") or {}
            generic = (ofda.get("generic_name") or [""])[0]
            brand = (ofda.get("brand_name") or [""])[0]
            return (
                _single_ingredient(generic, q),
                bool(brand) and q not in brand.lower(),
                bool(row.get("information_for_patients") or row.get("patient_medication_information")),
                bool(row.get("adverse_reactions")),
            )

        return max(rows, key=score)
    return None


def _common_side_effects(label: dict[str, Any]) -> str:
    text = " ".join(str(x) for x in label.get("adverse_reactions") or [] if x)
    text = re.sub(r"\(\s*[\d.,\s]+\)|\[[^\]]*\]", " ", text)
    text = re.sub(r"\s+", " ", text)
    idx = text.lower().find("most common")
    if idx < 0:
        return ""
    end = text.find(". ", idx)
    end = len(text) if end < 0 else end + 1
    sentence = re.split(r"\s+To report\b", text[idx:end], flags=re.I)[0]
    return _clean(sentence[:1].upper() + sentence[1:], 420)


def _label_summary(q: str) -> dict[str, Any]:
    label = _fetch_label(q)
    if not label:
        return {}
    ofda = label.get("openfda") or {}
    set_id = label.get("set_id") or ""
    return {
        "generic_name": (ofda.get("generic_name") or [q])[0].title(),
        "brand_names": sorted({b.title() for b in ofda.get("brand_name") or []})[:5],
        "manufacturer": (ofda.get("manufacturer_name") or [""])[0],
        "route": ", ".join(r.title() for r in ofda.get("route") or []),
        "drug_class": ", ".join(ofda.get("pharm_class_epc") or [])[:120],
        "indications": _field(label, "indications_and_usage", limit=520),
        "dosage": _field(label, "dosage_and_administration", limit=520),
        "boxed_warning": _field(label, "boxed_warning", limit=520),
        "warnings": _field(label, "warnings_and_cautions", "warnings", "precautions", limit=560),
        "side_effects": _common_side_effects(label) or _field(label, "adverse_reactions", limit=520),
        "patient_info": _field(
            label,
            "information_for_patients",
            "patient_medication_information",
            "spl_patient_package_insert",
            limit=560,
        ),
        "interactions": _field(label, "drug_interactions", limit=420),
        "effective_date": label.get("effective_time") or "",
        "label_url": f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={set_id}" if set_id else "",
    }


def _ndc_products(q: str) -> list[dict[str, str]]:
    s = f'generic_name:"{q}" AND finished:true'
    data = _get_json(f"{NDC}?search={urllib.parse.quote(s)}&limit=60")
    seen: set[tuple[str, str, str]] = set()
    out: list[dict[str, str]] = []
    rows = (data or {}).get("results") or []
    rows.sort(key=lambda r: not _single_ingredient(r.get("generic_name") or "", q))
    for row in rows:
        if not _single_ingredient(row.get("generic_name") or "", q) and len(out) >= 4:
            break
        ingredients = row.get("active_ingredients") or []
        strength = ", ".join(i.get("strength", "") for i in ingredients if i.get("strength"))
        item = {
            "brand": (row.get("brand_name") or "").title(),
            "labeler": row.get("labeler_name") or "",
            "form": (row.get("dosage_form") or "").title(),
            "strength": strength,
            "category": row.get("marketing_category") or "",
        }
        key = (item["labeler"].lower(), item["form"].lower(), item["strength"].lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out[:8]


def _faers(q: str) -> dict[str, Any]:
    s = urllib.parse.quote(f'patient.drug.openfda.generic_name:"{q}"')
    top = _get_json(f"{EVENT}?search={s}&count=patient.reaction.reactionmeddrapt.exact&limit=8")
    total = _get_json(f"{EVENT}?search={s}&limit=1")
    serious = _get_json(f"{EVENT}?search={s}+AND+serious:1&limit=1")

    def _total(d: Optional[dict]) -> int:
        return int(((d or {}).get("meta") or {}).get("results", {}).get("total") or 0)

    return {
        "total_reports": _total(total),
        "serious_reports": _total(serious),
        "top_reactions": [
            {"term": str(r.get("term", "")).capitalize(), "count": int(r.get("count") or 0)}
            for r in (top or {}).get("results") or []
        ],
    }


def drug_profile(name: str) -> dict[str, Any]:
    q = _query_name(name)
    if not q:
        return {"query": name, "found": False}
    now = time.time()
    with _lock:
        hit = _cache.get(q)
        if hit and now - hit[0] < CACHE_TTL_S:
            return hit[1]

    label_f = _fetch_pool.submit(_label_summary, q)
    ndc_f = _fetch_pool.submit(_ndc_products, q)
    faers_f = _fetch_pool.submit(_faers, q)

    def _result(future, default):
        try:
            return future.result(timeout=FETCH_TIMEOUT_S) or default
        except Exception:  # noqa: BLE001
            return default

    label = _result(label_f, {})
    products = _result(ndc_f, [])
    faers = _result(faers_f, {})

    found = bool(label or products or faers.get("total_reports"))
    profile = {
        "query": name,
        "found": found,
        **label,
        "generic_name": label.get("generic_name") or q.title(),
        "products": products,
        "manufacturers": sorted({p["labeler"] for p in products if p["labeler"]})[:6],
        "faers": faers,
        "sources": {
            "label": label.get("label_url") or "",
            "openfda": "https://open.fda.gov/apis/drug/",
        },
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if found:
        with _lock:
            _cache[q] = (now, profile)
    return profile


def warm(names: list[str]) -> None:
    """Prefetch profiles in the background so Ava can answer without a pause."""
    for n in names:
        q = _query_name(n)
        with _lock:
            if not q or q in _cache or q in _inflight:
                continue
            _inflight.add(q)
        _warm_pool.submit(_warm_one, n, q)


def _warm_one(name: str, q: str) -> None:
    try:
        drug_profile(name)
    finally:
        with _lock:
            _inflight.discard(q)


def mentioned_medicines(texts: list[str], medicines: list[tuple[str, str]]) -> list[str]:
    """Which of the patient's medicines (name, reason) the conversation is about."""
    low = " ".join(t.lower() for t in texts if t)
    if not low:
        return []
    hits: list[str] = []
    for name, reason in medicines:
        q = _query_name(name)
        aliases = {q, name.lower()} | set(CLASS_ALIASES.get(q, ()))
        aliases |= {b for b, g in BRAND_TO_GENERIC.items() if g == q}
        if any(re.search(rf"\b{re.escape(a)}\b", low) for a in aliases if a):
            hits.append(name)
    if hits:
        return hits[:3]
    if any(w in low for w in MED_QUESTION_WORDS):
        vague = {"blood", "heart", "control", "prevention", "protection", "rate", "care"}
        for name, reason in medicines:
            r = reason.lower()
            words = re.findall(r"[a-z]{4,}", r)
            bigrams = [f"{a} {b}" for a, b in zip(words, words[1:])]
            if (r and r in low) or any(b in low for b in bigrams) or any(
                re.search(rf"\b{w}\b", low) for w in words if w not in vague
            ):
                hits.append(name)
    return hits[:2]


def ava_reference(profile: dict[str, Any]) -> str:
    """Compact label facts for the assistant prompt."""
    if not profile.get("found"):
        return ""
    parts = [f"{profile.get('generic_name')}"]
    if profile.get("brand_names"):
        parts[0] += f" (brands: {', '.join(profile['brand_names'][:3])})"
    for key, title, limit in (
        ("indications", "Used for", 260),
        ("side_effects", "Common side effects", 300),
        ("boxed_warning", "Boxed warning", 260),
        ("warnings", "Warnings", 260),
        ("patient_info", "What patients should know", 300),
        ("interactions", "Interactions", 220),
    ):
        val = profile.get(key)
        if val:
            parts.append(f"{title}: {val[:limit]}")
    top = profile.get("faers", {}).get("top_reactions") or []
    if top:
        parts.append(
            "Most reported to FDA (reports do not prove cause): "
            + ", ".join(r["term"].lower() for r in top[:5])
        )
    return " | ".join(parts)
