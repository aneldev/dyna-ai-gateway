# Architecture

## About

How the gateway is built inside: its classes, how they connect, and why they are designed this way.

**Nothing in this section is required to use the library.** The [Getting started](../10-getting-started/00-README.md)
pages and the [Learning paths](../24-learning-paths/README.md) cover the use of the gateway without it.

## Description

The section describes the design as it is in the code. It has one page for the composition and its trade-offs, two
for the places where an application extends the gateway (storage and classes), two for single
mechanisms (the system prompt, changes at runtime), and the list of the design decisions.

## For whom is this chapter

- A developer who wants to know how the library works before relying on it.
- A developer who puts the gateway's data in the application's own database, or replaces one of its classes.
- A developer who met a behaviour that surprised them and wants the reason.

## The pages

| Page                                                                                       | The question it answers                                                                                           |
|--------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| [Architecture and trade-offs](10-architecture-and-trade-offs.md)                           | Which classes is the gateway made of, how does a call travel through them, and what does each design choice cost? |
| [Storage adapters](20-adapters.md)                                                         | How do I keep the gateway's data in my own database?                                                              |
| [Class replacement](30-class-replacement.md)                                               | How do I replace a part of the gateway with my own class?                                                         |
| [System prompt layers](40-system-prompt-production-layers.md)                              | Where does a sentence of the system prompt come from, and where do I put mine?                                    |
| [Live adjustment and dependency injection](50-live-adjustment-and-dependency-injection.md) | What can I change while the service runs, and what is fixed at construction?                                      |
| [Decisions](90-decisions.md)                                                               | Why does the gateway behave this way, and what do I do instead of what it refuses?                                |

## Summary

- The section is optional reading.
- Start with [Architecture and trade-offs](10-architecture-and-trade-offs.md) for the whole picture.
- To extend the gateway, read [Storage adapters](20-adapters.md) or [Class replacement](30-class-replacement.md).
- A decision id in the docs or in the JSDoc, such as `D46`, is an entry of [Decisions](90-decisions.md).

## FAQ

**Do I need to read this before my first call?** No. The getting-started examples run without it.

**Where is the reference of a class or an interface?** In the [API reference](../30-api/index.md). This section explains
how the parts fit together; the reference lists their members.

**Where is what the gateway does not do yet?** In the [Roadmap](../70-roadmap.md), and in the
[known limits](10-architecture-and-trade-offs.md#8-known-limits) of Architecture and trade-offs.
