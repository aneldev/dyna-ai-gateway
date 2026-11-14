---
description: "Proven practices for building LLM features in TypeScript: grounded RAG, human-in-the-loop approvals, prompt injection defense, context engineering, structured output, cost control, prompt caching and LLM-as-a-judge guardrails."
keywords: [AI best practices, LLM best practices, AI agent, RAG, guardrails, TypeScript, AI gateway]
---

# AI best practices

The library follows the industry standards for talking to a language model. How good an AI feature is depends less on
the library than on how it is used. Each page below takes one established practice, states the problem it solves, and
shows the practice with the code of `dyna-ai-gateway`. The samples show only the lines of the practice; each page links
the setup they run on.

| Practice                                                          | What it solves                                                       |
|-------------------------------------------------------------------|----------------------------------------------------------------------|
| [Context engineering](010-context-engineering.md)                 | the right information in the right layer, instead of a bigger prompt |
| [Stop hallucinations](020-stop-llm-hallucinations.md)             | fewer, visible and blockable hallucinations; quotes checked in code  |
| [Structured output with zod](030-structured-output-with-zod.md)   | typed data your code can act on, and a path for a schema miss        |
| [Guarded agent workflows](040-guarded-agent-workflows.md)         | the order of tool calls enforced in code                             |
| [Control LLM costs](050-control-llm-costs.md)                     | budgets per tenant and user that refuse before a call spends         |
| [Human-in-the-loop approvals](060-human-in-the-loop-approvals.md) | a person on the risky tool calls, decided per input                  |
| [Agent skills on demand](070-agent-skills-on-demand.md)           | long procedures that cost tokens only when a task needs them         |
| [Multi-tenant RAG](080-multi-tenant-rag.md)                       | no document reaches a user who may not read it                       |
| [Prompt injection defense](090-prompt-injection-defense.md)       | what an injected prompt can achieve, limited in layers               |
| [Ask instead of guess](100-ask-instead-of-guess.md)               | a clarifying question instead of an assumption                       |
| [Prompt caching](110-prompt-caching.md)                           | lower latency and input cost for the same system prompt              |
| [LLM-as-a-judge guardrails](120-llm-as-a-judge-guardrails.md)     | semantic checks of prompts and answers on a cheap model              |

Contributions are welcome: write to info@anel.co.
