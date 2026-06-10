from .beacon import BeaconAgent
from .counsel import CounselAgent
from .forge import ForgeAgent
from .haven import HavenAgent
from .herald import HeraldAgent
from .ledger import LedgerAgent
from .lens import LensAgent
from .mentor import MentorAgent
from .nexus import NexusAgent
from .oracle import OracleAgent
from .pulse import PulseAgent
from .scroll import ScrollAgent
from .shield import ShieldAgent
from .talent import TalentAgent
from .vantage import VantageAgent

AGENTS: dict = {
    "nexus": NexusAgent(),
    "vantage": VantageAgent(),
    "beacon": BeaconAgent(),
    "forge": ForgeAgent(),
    "pulse": PulseAgent(),
    "oracle": OracleAgent(),
    "scroll": ScrollAgent(),
    "lens": LensAgent(),
    "haven": HavenAgent(),
    "herald": HeraldAgent(),
    "mentor": MentorAgent(),
    "ledger": LedgerAgent(),
    "talent": TalentAgent(),
    "shield": ShieldAgent(),
    "counsel": CounselAgent(),
}

__all__ = ["AGENTS"]
