import httpx
from .base import BaseConnector, VerifyResult

class SlackConnector(BaseConnector):
    kind = "slack"
    display_name = "Slack"
    description = "Post notifications and summaries to Slack channels."
    credential_fields = [
        {"name": "bot_token", "label": "Bot Token", "placeholder": "xoxb-...", "type": "password",
         "help": "Create a Slack App → OAuth & Permissions → Bot Token Scopes: chat:write"},
        {"name": "default_channel", "label": "Default channel", "placeholder": "#general", "type": "text", "help": ""},
    ]

    def _h(self):
        return {"Authorization": f"Bearer {self.credentials['bot_token']}", "Content-Type": "application/json"}

    async def verify(self) -> VerifyResult:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post("https://slack.com/api/auth.test", headers=self._h())
                data = r.json()
            if not data.get("ok"):
                return VerifyResult(ok=False, label="Slack", error=data.get("error", "auth failed"))
            return VerifyResult(ok=True, label=f"Slack ({data.get('team','')} / {data.get('user','')})")
        except Exception as e:
            return VerifyResult(ok=False, label="Slack", error=str(e))

    async def post_message(self, text: str, channel: str = None) -> dict:
        ch = channel or self.credentials.get("default_channel", "#general")
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post("https://slack.com/api/chat.postMessage",
                             json={"channel": ch, "text": text}, headers=self._h())
            data = r.json()
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "slack error"))
        return {"ts": data["ts"], "channel": data["channel"]}
