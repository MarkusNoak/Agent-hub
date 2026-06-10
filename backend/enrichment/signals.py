"""Buying-timing and reachability signals from free public sources.

- find_company_news: Google News RSS (no key) — funding rounds, expansion,
  leadership changes, and other timing signals for outreach.
- check_email_domain: MX records via DNS-over-HTTPS (Google, no key) —
  validates that a domain can receive email and identifies the provider.
"""

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
