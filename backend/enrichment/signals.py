"""Buying-timing and reachability signals from free public sources.

- find_company_news: Google News RSS (no key) — funding rounds, expansion,
  leadership changes, and other timing signals for outreach.
- check_email_domain: MX records via DNS-over-HTTPS (Google, no key) —
  validates that a domain can receive email and identifies the provider.
"""

import re
import xml.etree.ElementTree as ET

import httpx

USER_AGENT = "AgentHub/2.0 (lead enrichment; contact: ops@agenthub.example)"
TIMEOUT = 15

MX_PROVIDERS = {
    "google.com": "Google Workspace",
    "googlemail.com": "Google Workspace",
    "outlook.com": "Microsoft 365",
    "protection.outlook.com": "Microsoft 365",
    "one.com": "one.com",
    "loopia.se": "Loopia",
    "simply.com": "Simply.com",
    "zoho.com": "Zoho Mail",
    "mimecast.com": "Mimecast",
    "pphosted.com": "Proofpoint",
    "messagelabs.com": "Symantec/Broadcom",
    "mailgun.org": "Mailgun",
    "secureserver.net": "GoDaddy",
    "emailsrvr.com": "Rackspace",
    "icloud.com": "Apple iCloud",
}

NEWS_LOCALES = {
    "sv": {"hl": "sv", "gl": "SE", "ceid": "SE:sv"},
    "no": {"hl": "no", "gl": "NO", "ceid": "NO:no"},
    "da": {"hl": "da", "gl": "DK", "ceid": "DK:da"},
    "fi": {"hl": "fi", "gl": "FI", "ceid": "FI:fi"},
    "en": {"hl": "en-US", "gl": "US", "ceid": "US:en"},
}


async def find_company_news(
    company_name: str, language: str = "en", limit: int = 8
) -> list[dict]:
    locale = NEWS_LOCALES.get(language.lower()[:2], NEWS_LOCALES["en"])
    params = {"q": f'"{company_name}"', **locale}

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(
            "https://news.google.com/rss/search",
            params=params,
            headers={"User-Agent": USER_AGENT},
        )
        resp.raise_for_status()
        xml_text = resp.text

    root = ET.fromstring(xml_text)
    items = []
    for item in root.iter("item"):
        source = item.find("source")
        items.append({
            "title": (item.findtext("title") or "").strip(),
            "published": item.findtext("pubDate"),
            "source": source.text.strip() if source is not None and source.text else None,
            "link": item.findtext("link"),
        })
        if len(items) >= limit:
            break
    return items


async def find_job_postings(company_name: str, limit: int = 10) -> dict:
    """Swedish job ads via Arbetsförmedlingen's open JobTech API (free, no
    key). Active postings are a strong hiring/growth/timing signal and often
    reveal tech stack and departments that are scaling."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(
            "https://jobsearch.api.jobtechdev.se/search",
            params={"q": company_name, "limit": min(limit, 20)},
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()

    tokens = [t for t in company_name.lower().split() if len(t) > 2]
    postings = []
    for hit in data.get("hits") or []:
        employer = ((hit.get("employer") or {}).get("name") or "")
        # Keep only ads whose employer actually matches the company
        if tokens and not any(t in employer.lower() for t in tokens):
            continue
        addr = hit.get("workplace_address") or {}
        postings.append({
            "headline": hit.get("headline"),
            "employer": employer,
            "municipality": addr.get("municipality"),
            "published": hit.get("publication_date"),
            "url": hit.get("webpage_url"),
        })

    return {
        "company": company_name,
        "total_matches": len(postings),
        "postings": postings[:limit],
        "source": "jobsearch.api.jobtechdev.se (Arbetsförmedlingen)",
        "note": None if postings else
                "No active Swedish job postings matched this employer.",
    }


# Canonical tech keywords mined from ad descriptions (the same API response
# we already pay zero for — more extraction, no extra calls)
AD_TECH_KEYWORDS = {
    "react native": "React Native", "react": "React", "vue": "Vue",
    "angular": "Angular", "typescript": "TypeScript", "next.js": "Next.js",
    "node": "Node.js", ".net": ".NET", "c#": "C#", "java ": "Java",
    "kotlin": "Kotlin", "swift": "Swift", "ios": "iOS", "android": "Android",
    "flutter": "Flutter", "python": "Python", "django": "Django",
    "php": "PHP", "laravel": "Laravel", "wordpress": "WordPress",
    "episerver": "Optimizely/Episerver", "optimizely": "Optimizely/Episerver",
    "umbraco": "Umbraco", "sitevision": "SiteVision", "magento": "Magento",
    "shopify": "Shopify", "aws": "AWS", "azure": "Azure",
    "google cloud": "GCP", "kubernetes": "Kubernetes", "docker": "Docker",
    "devops": "DevOps", "postgres": "PostgreSQL", "e-handel": "e-commerce",
}

CONSULTANT_MARKERS = ("konsult", "consultant", "inhyrd", "resurs- och kompetensförstärkning")


def _mine_ad_text(text: str) -> tuple[list[str], bool]:
    """Extract tech keywords and consultant mentions from ad description."""
    lower = " " + text.lower()
    tech = []
    for keyword, label in AD_TECH_KEYWORDS.items():
        if keyword in lower and label not in tech:
            tech.append(label)
    consultants = any(m in lower for m in CONSULTANT_MARKERS)
    return tech, consultants


async def search_hiring_companies(
    roles: list[str],
    regions: list[str] | None = None,
    max_companies: int = 15,
) -> dict:
    """Inverted JobTech search: occupation keywords → companies hiring NOW.

    This is the core of signal-first prospecting: instead of checking whether
    a known company hires, it harvests every Swedish employer currently
    advertising for the given roles. JobTech includes the employer's org
    number, which feeds exact duplicate detection downstream.
    """
    companies: dict[str, dict] = {}
    seen_ads: set[str] = set()

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for role in roles[:5]:
            resp = await client.get(
                "https://jobsearch.api.jobtechdev.se/search",
                params={"q": role, "limit": 100},
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            resp.raise_for_status()
            for hit in resp.json().get("hits") or []:
                # The same ad matches several role keywords — count it once
                ad_key = str(hit.get("id") or hit.get("webpage_url")
                             or hit.get("headline"))
                if ad_key in seen_ads:
                    continue
                seen_ads.add(ad_key)
                employer = (hit.get("employer") or {})
                name = (employer.get("name") or "").strip()
                if not name:
                    continue
                addr = hit.get("workplace_address") or {}
                region = addr.get("region") or ""
                municipality = addr.get("municipality") or ""

                if regions:
                    haystack = f"{region} {municipality}".lower()
                    if not any(r.lower().strip() in haystack for r in regions):
                        continue

                key = (employer.get("organization_number")
                       or name.lower())
                c = companies.setdefault(key, {
                    "company_name": name,
                    "org_number": employer.get("organization_number"),
                    "postings": 0,
                    "roles_advertised": [],
                    "locations": [],
                    "sample_ads": [],
                    "tech_in_ads": [],
                    "mentions_consultants": False,
                    "first_published": None,
                    "latest_published": None,
                })
                c["postings"] += 1

                # Mine the full ad text we already received
                desc = ((hit.get("description") or {}).get("text") or "")
                if desc:
                    tech, consultants = _mine_ad_text(desc[:8000])
                    for t in tech:
                        if t not in c["tech_in_ads"]:
                            c["tech_in_ads"].append(t)
                    c["mentions_consultants"] |= consultants
                occupation = ((hit.get("occupation") or {}).get("label")
                              or hit.get("headline"))
                if occupation and occupation not in c["roles_advertised"]:
                    c["roles_advertised"].append(occupation)
                loc = municipality or region
                if loc and loc not in c["locations"]:
                    c["locations"].append(loc)
                if len(c["sample_ads"]) < 3 and hit.get("headline"):
                    c["sample_ads"].append({
                        "headline": hit["headline"],
                        "url": hit.get("webpage_url"),
                    })
                pub = hit.get("publication_date")
                if pub:
                    if (c["latest_published"] is None
                            or pub > c["latest_published"]):
                        c["latest_published"] = pub
                    if (c["first_published"] is None
                            or pub < c["first_published"]):
                        c["first_published"] = pub

    ranked = sorted(companies.values(), key=lambda c: -c["postings"])
    return {
        "roles_searched": roles[:5],
        "regions_filter": regions,
        "companies_found": len(ranked),
        "companies": ranked[:max_companies],
        "source": "jobsearch.api.jobtechdev.se (Arbetsförmedlingen)",
    }



# Swedish funding headlines follow a tight pattern ("X tar in 40 miljoner"),
# tight enough for deterministic company extraction — no LLM cost in harvest
FUNDING_VERBS = r"(?:tar in|h\u00e4mtar(?: in)?|reser|s\u00e4krar|plockar in|f\u00e5r in|landar)"
FUNDING_RE = re.compile(
    rf"^(?P<co>[^\u2013\u2014:|]{{2,60}}?)\s+{FUNDING_VERBS}\s+"
    rf"(?P<amt>[\d.,]+\s*(?:miljoner|miljarder|mkr|msek|mnkr|msek kronor)?)",
    re.IGNORECASE,
)
GENERIC_SUBJECTS = ("svenska", "flera", "allt fler", "bolag", "startups",
                    "techbolag", "han", "hon", "de ")


def extract_funding_companies(items: list[dict]) -> list[dict]:
    """Deterministically pull company names out of Swedish funding
    headlines. Conservative: skips anything that doesn't match the
    canonical pattern or looks like a generic subject."""
    found = []
    seen = set()
    for item in items:
        title = (item.get("title") or "").strip()
        # Google News appends " - Source"; drop the final segment
        if " - " in title:
            title = title.rsplit(" - ", 1)[0].strip()
        m = FUNDING_RE.match(title)
        if not m:
            continue
        company = m.group("co").strip().strip('"\u201d\u201c').strip()
        lower = company.lower()
        if (not company or not company[0].isupper()
                or len(company.split()) > 6
                or any(lower.startswith(g) for g in GENERIC_SUBJECTS)):
            continue
        key = lower
        if key in seen:
            continue
        seen.add(key)
        found.append({
            "company_name": company,
            "amount": (m.group("amt") or "").strip(),
            "headline": title,
            "link": item.get("link"),
            "published": item.get("published"),
        })
    return found


async def _news_rss_search(query: str, limit: int = 10,
                           language: str = "sv") -> list[dict]:
    """Shared Google News RSS search → list of headline items."""
    locale = NEWS_LOCALES.get(language, NEWS_LOCALES["sv"])
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(
            "https://news.google.com/rss/search",
            params={"q": query, **locale},
            headers={"User-Agent": USER_AGENT},
        )
        resp.raise_for_status()
        xml_text = resp.text

    root = ET.fromstring(xml_text)
    items = []
    for item in root.iter("item"):
        source = item.find("source")
        items.append({
            "title": (item.findtext("title") or "").strip(),
            "published": item.findtext("pubDate"),
            "source": source.text.strip() if source is not None and source.text else None,
            "link": item.findtext("link"),
        })
        if len(items) >= limit:
            break
    return items


async def scan_funding_news(topic: str | None = None, limit: int = 10) -> dict:
    """Scan Swedish business press for fresh funding rounds — companies that
    just raised capital fund digital projects. Returns headlines for the
    agent to extract company names from."""
    query = '"tar in" OR "kapitalrunda" OR "miljoner i en runda" OR "nyemission"'
    if topic:
        query = f"{topic} ({query})"
    items = await _news_rss_search(query, limit)
    return {
        "topic": topic,
        "headlines": items,
        "note": ("Extract the company names from these headlines, then "
                 "enrich the relevant ones." if items else
                 "No recent funding news matched."),
    }


def _clean_headline(title: str) -> str:
    # Google News appends " - Source"; drop the final segment
    if " - " in title:
        title = title.rsplit(" - ", 1)[0].strip()
    return title


def _plausible_company(name: str) -> bool:
    lower = name.lower()
    return bool(
        name and name[0].isupper()
        and len(name.split()) <= 6
        and not any(lower.startswith(g) for g in GENERIC_SUBJECTS)
    )


# Swedish expansion headlines: new offices, market entries, big hiring plans.
# Same playbook as funding — tight patterns, deterministic, zero LLM cost.
EXPANSION_PATTERNS = [
    (re.compile(r"^(?P<co>[^–—:|]{2,60}?)\s+(?:öppnar|etablerar)\s+"
                r"(?:nytt\s+|ett\s+)?kontor\s+i\s+(?P<detail>.{2,40})$",
                re.IGNORECASE),
     "office", "öppnar kontor i {}"),
    (re.compile(r"^(?P<co>[^–—:|]{2,60}?)\s+expanderar\s+(?:till|i)\s+"
                r"(?P<detail>.{2,40})$", re.IGNORECASE),
     "market", "expanderar till {}"),
    (re.compile(r"^(?P<co>[^–—:|]{2,60}?)\s+etablerar\s+sig\s+i\s+"
                r"(?P<detail>.{2,40})$", re.IGNORECASE),
     "market", "etablerar sig i {}"),
    (re.compile(r"^(?P<co>[^–—:|]{2,60}?)\s+(?:anställer|nyanställer)\s+"
                r"(?P<detail>\d{2,4})(?:\s|$)", re.IGNORECASE),
     "hiring_plan", "anställer {} personer"),
]


def extract_expansion_companies(items: list[dict]) -> list[dict]:
    """Deterministically pull expanding companies out of Swedish headlines.
    Conservative: only canonical patterns, generic subjects skipped."""
    found, seen = [], set()
    for item in items:
        title = _clean_headline((item.get("title") or "").strip())
        for pattern, kind, template in EXPANSION_PATTERNS:
            m = pattern.match(title)
            if not m:
                continue
            company = m.group("co").strip().strip('"”“').strip()
            if not _plausible_company(company):
                break
            key = company.lower()
            if key in seen:
                break
            seen.add(key)
            detail = (m.group("detail") or "").strip().rstrip(".")
            found.append({
                "company_name": company,
                "detail": template.format(detail),
                "kind": kind,
                "headline": title,
                "link": item.get("link"),
                "published": item.get("published"),
            })
            break
    return found


async def scan_expansion_news(limit: int = 20) -> dict:
    """Swedish expansion/establishment headlines — companies opening offices,
    entering new markets or announcing large hiring plans. Growth that size
    almost always drags digital projects with it."""
    query = ('"öppnar nytt kontor" OR "expanderar till" OR '
             '"etablerar sig i" OR "nyanställer"')
    items = await _news_rss_search(query, limit)
    return {"headlines": items}


# New executives review suppliers and digital tooling in their first months —
# a leadership change is a fresh-door signal for outreach.
LEADERSHIP_ROLES = (r"vd|vice vd|cto|cio|cfo|cdo|it-chef|teknikchef|"
                    r"digitaliseringschef|marknadschef|e-handelschef")
LEADERSHIP_PATTERNS = [
    # "Anna Svensson blir ny vd på Bolaget AB"
    re.compile(rf"^(?P<person>[A-ZÅÄÖ][^–—:|]{{2,40}}?)\s+"
               rf"(?:blir|utses till|tillträder som)\s+ny\s+"
               rf"(?P<role>{LEADERSHIP_ROLES})\s+(?:på|för|i|hos)\s+"
               rf"(?P<co>.{{2,60}})$", re.IGNORECASE),
    # "Bolaget AB får ny vd" / "Bolaget utser Anna Svensson till ny vd"
    re.compile(rf"^(?P<co>[^–—:|]{{2,60}}?)\s+"
               rf"(?:får|utser|rekryterar|hämtar)\s+"
               rf"(?:(?P<person>[A-ZÅÄÖ][^–—:|]{{2,40}}?)\s+"
               rf"(?:till|som)\s+)?ny\s+(?P<role>{LEADERSHIP_ROLES})\b", re.IGNORECASE),
]


def extract_leadership_changes(items: list[dict]) -> list[dict]:
    """Deterministically pull leadership changes (company + role, person when
    the headline names one) out of Swedish business headlines."""
    found, seen = [], set()
    for item in items:
        title = _clean_headline((item.get("title") or "").strip())
        for pattern in LEADERSHIP_PATTERNS:
            m = pattern.match(title)
            if not m:
                continue
            company = m.group("co").strip().strip('"”“').strip()
            if not _plausible_company(company):
                break
            key = company.lower()
            if key in seen:
                break
            seen.add(key)
            person = (m.groupdict().get("person") or "").strip() or None
            found.append({
                "company_name": company,
                "person": person,
                "role": m.group("role").lower(),
                "headline": title,
                "link": item.get("link"),
                "published": item.get("published"),
            })
            break
    return found


async def scan_leadership_news(limit: int = 20) -> dict:
    """Swedish executive-change headlines — new CEOs/CTOs/IT chiefs review
    suppliers and digital tooling in their first hundred days."""
    query = ('"blir ny vd" OR "får ny vd" OR "tillträder som vd" OR '
             '"ny cto" OR "ny it-chef" OR "ny digitaliseringschef"')
    items = await _news_rss_search(query, limit)
    return {"headlines": items}


# ── Website-existence probe (digital-gap signal) ──────────────────────────────

_DOMAIN_SUFFIXES = (" aktiebolag", " ab", " handelsbolag", " hb",
                    " kommanditbolag", " kb", " ekonomisk förening", " ek för")
_DOMAIN_TRANSLATE = str.maketrans("åäöéü", "aaoeu")


def _domain_candidates(company_name: str) -> list[str]:
    """Guess the .se domains a Swedish company would most likely register."""
    base = company_name.lower().strip()
    for suffix in _DOMAIN_SUFFIXES:
        if base.endswith(suffix):
            base = base[: -len(suffix)].strip()
    base = base.translate(_DOMAIN_TRANSLATE)
    base = re.sub(r"[^a-z0-9 -]", "", base)
    words = [w for w in base.split() if w]
    if not words:
        return []
    candidates = []
    joined = "".join(words)
    if 3 <= len(joined) <= 30:
        candidates.append(f"{joined}.se")
    if len(words) > 1:
        hyphenated = "-".join(words)
        if len(hyphenated) <= 30:
            candidates.append(f"{hyphenated}.se")
    return candidates[:2]


async def check_website_exists(company_name: str) -> dict:
    """Free DNS probe: does this company appear to have a website at all?

    Heuristic by design — it only checks the most likely .se domains, so
    has_website=False means "no site found on expected domains", not proof.
    A newly registered company without a website is the highest-intent
    prospect there is for web development."""
    candidates = _domain_candidates(company_name)
    if not candidates:
        return {"company": company_name, "has_website": None,
                "checked": [], "note": "Company name not domainable."}

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for domain in candidates:
            resp = await client.get(
                "https://dns.google/resolve",
                params={"name": domain, "type": "A"},
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            resp.raise_for_status()
            answers = resp.json().get("Answer") or []
            if any(a.get("type") == 1 for a in answers):
                return {"company": company_name, "has_website": True,
                        "domain": domain, "checked": candidates}

    return {"company": company_name, "has_website": False, "domain": None,
            "checked": candidates,
            "note": "No A record on expected .se domains (heuristic)."}


async def check_email_domain(domain: str) -> dict:
    domain = domain.strip().lower()
    if "@" in domain:
        domain = domain.split("@", 1)[1]

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(
            "https://dns.google/resolve",
            params={"name": domain, "type": "MX"},
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()

    answers = data.get("Answer") or []
    mx_hosts = []
    for a in answers:
        if a.get("type") == 15:  # MX
            parts = (a.get("data") or "").split()
            if len(parts) == 2:
                mx_hosts.append(parts[1].rstrip("."))

    provider = None
    for host in mx_hosts:
        for suffix, name in MX_PROVIDERS.items():
            if host.lower().endswith(suffix):
                provider = name
                break
        if provider:
            break

    return {
        "domain": domain,
        "accepts_email": bool(mx_hosts),
        "mx_records": mx_hosts[:5],
        "email_provider": provider,
        "note": None if mx_hosts else
                "No MX records — emails to this domain will bounce.",
    }


async def domain_age(domain: str) -> dict:
    """Registration date for .se/.nu domains via Internetstiftelsen's free
    RDAP API. A freshly registered domain means the company is building its
    digital presence RIGHT NOW — the sharpest timing signal there is for a
    web seller."""
    root = domain.lower().strip().removeprefix("https://")\
        .removeprefix("http://").removeprefix("www.").split("/")[0]
    if not root.endswith((".se", ".nu")):
        return {"domain": root, "registered": None,
                "note": "RDAP age check covers .se/.nu only."}
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(
            f"https://rdap.iis.se/domain/{root}",
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        if resp.status_code == 404:
            return {"domain": root, "registered": None,
                    "note": "Domain not registered."}
        resp.raise_for_status()
        data = resp.json()
    registered = None
    for event in data.get("events") or []:
        if event.get("eventAction") == "registration":
            registered = (event.get("eventDate") or "")[:10]
            break
    age_days = None
    if registered:
        from datetime import date
        try:
            y, m, d = (int(x) for x in registered.split("-"))
            age_days = (date.today() - date(y, m, d)).days
        except ValueError:
            pass
    return {"domain": root, "registered": registered, "age_days": age_days,
            "source": "rdap.iis.se (Internetstiftelsen)"}
