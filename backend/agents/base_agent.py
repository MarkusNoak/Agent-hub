import os
from abc import ABC, abstractmethod
from anthropic import AsyncAnthropic
from typing import AsyncGenerator


class BaseAgent(ABC):
    """Abstract base class for all agents in the hub."""

    def __init__(self):
        self._client: AsyncAnthropic | None = None

    @property
    def client(self) -> AsyncAnthropic:
        if self._client is None:
            self._client = AsyncAnthropic()
        return self._client

    @property
    @abstractmethod
    def agent_id(self) -> str:
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        pass

    @property
    @abstractmethod
    def color(self) -> str:
        pass

    @property
    @abstractmethod
    def sprite_key(self) -> str:
        pass

    @property
    @abstractmethod
    def system_prompt(self) -> str:
        pass

    @property
    def model(self) -> str:
        return os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")

    @property
    def max_tokens(self) -> int:
        return 4096

    async def stream_response(
        self,
        message: str,
        history: list[dict],
    ) -> AsyncGenerator[str, None]:
        messages = history + [{"role": "user", "content": message}]
        async with self.client.messages.stream(
            model=self.model,
            max_tokens=self.max_tokens,
            system=self.system_prompt,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    def to_dict(self) -> dict:
        return {
            "id": self.agent_id,
            "name": self.name,
            "description": self.description,
            "color": self.color,
            "sprite_key": self.sprite_key,
        }
