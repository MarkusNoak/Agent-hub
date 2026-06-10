"""Company website analysis — free enrichment from the company's own site.

Fetches the homepage (and a contact page if needed) and extracts:
title/description, contact emails, social profiles, detected technology
stack, and language. Tech and contact signals feed VANTAGE's lead scoring
(reachability and product fit).
"""

import re

import httpx

USER_AGENT = "AgentHub/2.0 (lead enrichment; contact: ops@agenthub.example)"
TIMEOUT = 15
MAX_BYTES = 600_000

# Signature → product. Matched against raw HTML, case-insensitive.
TECH_SIGNATURES = {
    "wp-content": "WordPress",
    "cdn.shopify.com": "Shopify",
    "js.hs-scripts.com": "HubSpot",
    "hsforms.net": "HubSpot Forms",
    "widget.intercom.io": "Intercom",
    "googletagmanager.com": "Google Tag Manager",
    "google-analytics.com": "Google Analytics",
    "static.klaviyo.com": "Klaviyo",
    "js.stripe.com": "Stripe",
    "assets.squarespace.com": "Squarespace",
    "static.parastorage.com": "Wix",
    "website-files.com": "Webflow",
    "__next_data__": "Next.js",
    "data-reactroot": "React",
    "zdassets.com": "Zendesk",
    "js.driftt.com": "Drift",
    "matomo.js": "Matomo",
    "plausible.io/js": "Plausible",
    "list-manage.com": "Mailchimp",
    "typeform.com/to/": "Typeform",
    "usercentrics": "Usercentrics",
    "cookiebot.com": "Cookiebot",
}

SOCIAL_PATTERNS = {
    "linkedin": r'https?://(?:[a-z]{2,3}\.)?linkedin\.com/company/[\w\-%.]+',
    "facebook": r'https?://(?:www\.)?facebook\.com/[\w\-.]+',
    "instagram": r'https?://(?:www\.)?instagram\.com/[\w\-.]+',
    "x_twitter": r'https?://(?:www\.)?(?:twitter|x)\.com/[\w]+',
    "github": r'https?://github\.com/[\w\-]+',
    "youtube": r'https?://(?:www\.)?youtube\.com/(?:@|channel/|c/)[\w\-]+',
}

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
# Common asset/file false positives
EMAIL_JUNK = re.compile(r"\.(png|jpe?g|gif|svg|webp|css|js)$", re.I)

CONTACT_PATHS = ["/contact", "/kontakt", "/contact-us", "/om-oss", "/about"]


def _normalize_url(domain: str) -> str:
    domain = domain.strip()
    if domain.startswith(("http://", "https://")):
        return domain
    return f"https://{domain}"


def _extract_meta(html: str, name: str) -> str | None:
    m = re.search(
        rf'<meta[^>]+(?:name|property)=["\']{name}["\'][^>]+content=["\']([^"\']+)',
        html, re.I,
    ) or re.search(
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:name|property)=["\']{name}["\']',
        html, re.I,
    )
    return m.group(1).strip() if m else None


def _extract_emails(html: str, domain: str) -> list[str]:
    emails = set()
    for email in EMAIL_RE.findall(html):
        email = email.lower().rstrip(".")
        if EMAIL_JUNK.search(email):
            continue
        # Prefer same-domain addresses; keep others only if obviously contact-y
        root = domain.lower().removeprefix("www.")
        if email.endswith("@" + root) or email.split("@")[0] in (
            "info", "hello", "contact", "kontakt", "sales", "post",
        ):
            emails.add(email)
    return sorted(emails)[:5]


async def _fetch(client: httpx.AsyncClient, url: str) -> str | None:
    try:
        resp = await client.get(url, headers={"User-Agent": USER_AGENT})
        if resp.status_code >= 400:
            return None
        return resp.text[:MAX_BYTES]
    except httpx.HTTPError:
        return None


async def analyze_website(domain: str) -> dict:
    url = _normalize_url(domain)
    host = re.sub(r"^https?://", "", url).split("/")[0]

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        html = await _fetch(client, url)
        if html is None:
            return {"error": f"Could not fetch {url}", "domain": host}

        title_m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
        lang_m = re.search(r'<html[^>]+lang=["\']([a-zA-Z\-]+)', html, re.I)

        lower = html.lower()
        tech = sorted({label for sig, label in TECH_SIGNATURES.items()
                       if sig in lower})

        socials = {}
        for key, pattern in SOCIAL_PATTERNS.items():
            m = re.search(pattern, html, re.I)
            if m:
                socials[key] = m.group(0)

        emails = _extract_emails(html, host)
        contact_page_checked = None
        if not emails:
            for path in CONTACT_PATHS[:2]:
                contact_html = await _fetch(client, url.rstrip("/") + path)
                if contact_html:
                    emails = _extract_emails(contact_html, host)
                    contact_page_checked = path
                    if emails:
                        break

    return {
        "domain": host,
        "title": title_m.group(1).strip() if title_m else None,
        "description": _extract_meta(html, "description")
                       or _extract_meta(html, "og:description"),
        "language": lang_m.group(1) if lang_m else None,
        "tech_stack": tech,
        "social_profiles": socials,
        "contact_emails": emails,
        "contact_page_checked": contact_page_checked,
        "source": "website",
    }
