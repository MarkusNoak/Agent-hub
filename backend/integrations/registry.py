import json
import database as db
from .crypto import decrypt
from .gmail import GmailConnector
from .github import GitHubConnector
from .linkedin import LinkedInConnector
from .slack import SlackConnector

CONNECTOR_CLASSES = {
    "gmail": GmailConnector,
    "github": GitHubConnector,
    "linkedin": LinkedInConnector,
    "slack": SlackConnector,
}

async def get_connector(org_id: str, kind: str):
    row = await db.get_integration(org_id, kind)
    if not row or row.get("status") == "paused":
        return None
    try:
        creds = decrypt(row["credentials"])
        config = json.loads(row.get("config") or "{}")
        return CONNECTOR_CLASSES[kind](creds, config)
    except Exception:
        return None

def list_connector_meta() -> list:
    return [
        {"kind": cls.kind, "display_name": cls.display_name,
         "description": cls.description, "credential_fields": cls.credential_fields}
        for cls in CONNECTOR_CLASSES.values()
    ]
