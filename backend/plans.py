"""Subscription plans and quota definitions for the Agent Hub SaaS."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    price_monthly_eur: int          # display price; billing handled by provider
    messages_per_month: int         # -1 = unlimited
    leads_per_month: int            # -1 = unlimited
    seats: int                      # -1 = unlimited
    agent_tier: int                 # agents with tier <= this are available
    features: list[str] = field(default_factory=list)


PLANS: dict[str, Plan] = {
    "free": Plan(
        id="free",
        name="Free",
        price_monthly_eur=0,
        messages_per_month=50,
        leads_per_month=10,
        seats=1,
        agent_tier=0,
        features=["3 core agents", "50 messages/month", "Community support"],
    ),
    "starter": Plan(
        id="starter",
        name="Starter",
        price_monthly_eur=49,
        messages_per_month=1000,
        leads_per_month=100,
        seats=5,
        agent_tier=1,
        features=[
            "9 specialist agents",
            "1 000 messages/month",
            "100 leads/month",
            "5 seats",
            "Email support",
        ],
    ),
    "pro": Plan(
        id="pro",
        name="Pro",
        price_monthly_eur=199,
        messages_per_month=10000,
        leads_per_month=1000,
        seats=25,
        agent_tier=2,
        features=[
            "All 13 agents incl. VANTAGE lead generation",
            "10 000 messages/month",
            "1 000 leads/month",
            "25 seats",
            "API access",
            "Priority support",
        ],
    ),
    "enterprise": Plan(
        id="enterprise",
        name="Enterprise",
        price_monthly_eur=999,
        messages_per_month=-1,
        leads_per_month=-1,
        seats=-1,
        agent_tier=3,
        features=[
            "Everything in Pro",
            "Unlimited usage",
            "Unlimited seats",
            "Custom agents & integrations",
            "Dedicated success manager",
            "SLA & SSO",
        ],
    ),
}


def get_plan(plan_id: str) -> Plan:
    return PLANS.get(plan_id, PLANS["free"])


def plan_allows_agent(plan_id: str, agent_tier: int) -> bool:
    return agent_tier <= get_plan(plan_id).agent_tier


def within_quota(used: int, limit: int) -> bool:
    return limit < 0 or used < limit
