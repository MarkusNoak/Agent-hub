import httpx
from .base import BaseConnector, VerifyResult

GITHUB_API = "https://api.github.com"

class GitHubConnector(BaseConnector):
    kind = "github"
    display_name = "GitHub"
    description = "Read issues, PRs, and repository docs to support delivery."
    credential_fields = [
        {"name": "token", "label": "Personal Access Token", "placeholder": "ghp_...", "type": "password",
         "help": "GitHub → Settings → Developer settings → Personal access tokens"},
        {"name": "org", "label": "Default organisation (optional)", "placeholder": "acme-corp", "type": "text", "help": ""},
    ]

    def _h(self):
        return {"Authorization": f"Bearer {self.credentials['token']}", "Accept": "application/vnd.github+json"}

    async def verify(self) -> VerifyResult:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(f"{GITHUB_API}/user", headers=self._h())
                r.raise_for_status()
                user = r.json()
            return VerifyResult(ok=True, label=f"GitHub ({user['login']})")
        except Exception as e:
            return VerifyResult(ok=False, label="GitHub", error=str(e))

    async def list_issues(self, repo: str, state="open", limit=20) -> list:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{GITHUB_API}/repos/{repo}/issues",
                            params={"state": state, "per_page": limit}, headers=self._h())
            r.raise_for_status()
        return [{"number": i["number"], "title": i["title"], "state": i["state"],
                 "url": i["html_url"], "labels": [l["name"] for l in i.get("labels",[])],
                 "created_at": i["created_at"]} for i in r.json()]

    async def list_prs(self, repo: str, state="open", limit=20) -> list:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{GITHUB_API}/repos/{repo}/pulls",
                            params={"state": state, "per_page": limit}, headers=self._h())
            r.raise_for_status()
        return [{"number": p["number"], "title": p["title"], "state": p["state"],
                 "url": p["html_url"], "draft": p["draft"],
                 "created_at": p["created_at"]} for p in r.json()]

    async def read_file(self, repo: str, path: str) -> str:
        import base64
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{GITHUB_API}/repos/{repo}/contents/{path}", headers=self._h())
            r.raise_for_status()
        return base64.b64decode(r.json()["content"]).decode()
