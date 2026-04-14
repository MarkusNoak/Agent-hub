from .nexus import NexusAgent
from .oracle import OracleAgent
from .forge import ForgeAgent
from .scroll import ScrollAgent
from .lens import LensAgent
from .shield import ShieldAgent
from .herald import HeraldAgent

AGENTS: dict = {
    "nexus": NexusAgent(),
    "oracle": OracleAgent(),
    "forge": ForgeAgent(),
    "scroll": ScrollAgent(),
    "lens": LensAgent(),
    "shield": ShieldAgent(),
    "herald": HeraldAgent(),
}

__all__ = ["AGENTS"]
