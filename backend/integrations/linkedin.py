import httpx
from .base import BaseConnector, VerifyResult

class LinkedInConnector(BaseConnector):
    kind = "linkedin"
    display_name = "LinkedIn"
    description = "Draft and publish posts on behalf of a LinkedIn profile or company page."
    credential_fields = [
        {"name": "access_token", "label": "Access Token", "placeholder": "AQV...", "type": "password",
         "help": "LinkedIn Developer Console → OAuth 2.0 tools → token with w_member_social scope"},
        {"name": "author_urn", "label": "Author URN", "placeholder": "urn:li:person:xxxx", "type": "text",
         "help": "Your profile or company page URN"},
    ]

    def _h(self):
        return {"Authorization": f"Bearer {self.credentials['access_token']}",
                "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0"}

    async def verify(self) -> VerifyResult:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get("https://api.linkedin.com/v2/userinfo", headers=self._h())
                r.raise_for_status()
                info = r.json()
            name = info.get("name") or info.get("sub", "?")
            return VerifyResult(ok=True, label=f"LinkedIn ({name})")
        except Exception as e:
            return VerifyResult(ok=False, label="LinkedIn", error=str(e))

    async def create_post(self, text: str, visibility="PUBLIC") -> dict:
        payload = {
            "author": self.credentials["author_urn"],
            "lifecycleState": "PUBLISHED",
            "specificContent": {"com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": text},
                "shareMediaCategory": "NONE"
            }},
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": visibility}
        }
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post("https://api.linkedin.com/v2/ugcPosts", json=payload, headers=self._h())
            r.raise_for_status()
        return {"post_id": r.headers.get("x-restli-id", ""), "status": "published"}

    async def create_draft(self, text: str) -> dict:
        return {"draft": True, "author": self.credentials["author_urn"], "text": text}
