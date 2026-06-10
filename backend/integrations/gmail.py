import smtplib, ssl
from .base import BaseConnector, VerifyResult

class GmailConnector(BaseConnector):
    kind = "gmail"
    display_name = "Gmail"
    description = "Send outreach emails from your Gmail account via App Password."
    credential_fields = [
        {"name": "from_email", "label": "Gmail address", "placeholder": "you@company.com", "type": "email", "help": ""},
        {"name": "app_password", "label": "App Password", "placeholder": "xxxx xxxx xxxx xxxx", "type": "password",
         "help": "Google Account → Security → 2-Step Verification → App passwords"},
    ]

    async def verify(self) -> VerifyResult:
        try:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx) as s:
                s.login(self.credentials["from_email"], self.credentials["app_password"].replace(" ", ""))
            return VerifyResult(ok=True, label=f"Gmail ({self.credentials['from_email']})")
        except Exception as e:
            return VerifyResult(ok=False, label="Gmail", error=str(e))

    def smtp_params(self) -> dict:
        return {
            "host": "smtp.gmail.com", "port": 465, "ssl": True,
            "user": self.credentials["from_email"],
            "password": self.credentials["app_password"].replace(" ", ""),
            "from": self.credentials["from_email"],
        }
