import os
from abc import ABC, abstractmethod
from typing import AsyncGenerator

from anthropic import AsyncAnthropic

from agent_tools import Tool, ToolContext

MAX_TOOL_ROUNDS = 8
TOOL_RESULT_MAX_CHARS = 20_000


class BaseAgent(ABC):
    """Base class for all agents.

    Agents stream events rather than raw text so the transport layer can
    surface tool activity and usage metering alongside the response:

        {"type": "text",       "content": str}
        {"type": "tool_start", "name": str, "input": dict}
        {"type": "tool_end",   "name": str, "ok": bool}
        {"type": "usage",      "input_tokens": int, "output_tokens": int}
    """

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
    def category(self) -> str:
        return "general"

    @property
    def tier(self) -> int:
        """Minimum plan tier required: 0=free, 1=starter, 2=pro, 3=enterprise."""
        return 1

    @property
    def tools(self) -> list[Tool]:
        return []

    @property
    def model(self) -> str:
        return os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")

    @property
    def max_tokens(self) -> int:
        return 4096

    async def _execute_tool(self, name: str, tool_input: dict, ctx: ToolContext) -> str:
        for tool in self.tools:
            if tool.name == name:
                try:
                    result = await tool.handler(tool_input, ctx)
                except Exception as e:
                    return f'{{"error": "Tool execution failed: {e}"}}'
                return result[:TOOL_RESULT_MAX_CHARS]
        return f'{{"error": "Unknown tool: {name}"}}'

    async def run(
        self,
        message: str,
        history: list[dict],
        ctx: ToolContext,
    ) -> AsyncGenerator[dict, None]:
        messages = history + [{"role": "user", "content": message}]
        tool_defs = [t.to_anthropic() for t in self.tools]
        # Prompt caching: the system prompt and tool definitions are
        # identical on every call, so cache them server-side — cached input
        # tokens cost ~10% of normal, which dominates in tool-use loops
        system_blocks = [{
            "type": "text",
            "text": self.system_prompt,
            "cache_control": {"type": "ephemeral"},
        }]
        if tool_defs:
            tool_defs[-1] = {**tool_defs[-1],
                             "cache_control": {"type": "ephemeral"}}

        for _ in range(MAX_TOOL_ROUNDS):
            kwargs: dict = {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "system": system_blocks,
                "messages": messages,
            }
            if tool_defs:
                kwargs["tools"] = tool_defs

            async with self.client.messages.stream(**kwargs) as stream:
                async for text in stream.text_stream:
                    yield {"type": "text", "content": text}
                final = await stream.get_final_message()

            yield {
                "type": "usage",
                "input_tokens": final.usage.input_tokens,
                "output_tokens": final.usage.output_tokens,
            }

            if final.stop_reason != "tool_use":
                return

            # Run requested tools, then continue the loop with their results
            messages.append({"role": "assistant", "content": final.content})
            results = []
            for block in final.content:
                if block.type != "tool_use":
                    continue
                yield {"type": "tool_start", "name": block.name,
                       "input": block.input}
                result = await self._execute_tool(block.name, block.input, ctx)
                ok = '"error"' not in result[:60]
                yield {"type": "tool_end", "name": block.name, "ok": ok}
                results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })
            messages.append({"role": "user", "content": results})

        yield {
            "type": "text",
            "content": "\n\n*(Stopped: maximum tool rounds reached.)*",
        }

    def to_dict(self) -> dict:
        return {
            "id": self.agent_id,
            "name": self.name,
            "description": self.description,
            "color": self.color,
            "sprite_key": self.sprite_key,
            "category": self.category,
            "tier": self.tier,
            "has_tools": bool(self.tools),
        }
