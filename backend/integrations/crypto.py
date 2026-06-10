import os, json, base64, hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def _key() -> bytes:
    raw = os.environ.get("CREDENTIALS_KEY", "dev-insecure-key-change-in-prod")
    return hashlib.sha256(raw.encode()).digest()

def encrypt(data: dict) -> str:
    aesgcm = AESGCM(_key())
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, json.dumps(data).encode(), None)
    return base64.b64encode(nonce + ct).decode()

def decrypt(token: str) -> dict:
    raw = base64.b64decode(token)
    aesgcm = AESGCM(_key())
    pt = aesgcm.decrypt(raw[:12], raw[12:], None)
    return json.loads(pt)
