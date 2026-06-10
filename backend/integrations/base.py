from abc import ABC, abstractmethod
from dataclasses import dataclass, field

@dataclass
class VerifyResult:
    ok: bool
    label: str
    error: str = ""

class BaseConnector(ABC):
    kind: str = ""
    display_name: str = ""
    description: str = ""
    credential_fields: list = []

    def __init__(self, credentials: dict, config: dict = None):
        self.credentials = credentials
        self.config = config or {}

    @abstractmethod
    async def verify(self) -> VerifyResult: ...
