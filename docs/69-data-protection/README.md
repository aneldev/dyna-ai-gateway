---
description: "Data protection for LLM applications built on an AI gateway: what GDPR, CCPA and HIPAA require, the gateway's tools for access, erasure and retention, and the practices."
keywords: [data protection, GDPR, CCPA, HIPAA, LLM privacy, AI compliance, right to erasure, data retention, AI gateway, TypeScript]
---

# Data protection

## About

An application built on the gateway sends personal data to an LLM provider and keeps conversations, remembered facts
and a trace of every model call. This section states what the privacy laws require of it, which tools the gateway gives
for those duties, and how to use them.

The section is technical documentation, not legal advice: the application's counsel decides how a law applies to it.

## For whom is this section

- A developer who puts the gateway in front of users in the EU, in California or in US health care.
- A developer who must answer a request to access or erase a user's data.
- A team that chooses an LLM provider, a retention period or a memory setting and needs the facts behind the choice.

## The pages

| Page                                                                   | The question it answers                                                                           |
|------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| [GDPR, CCPA and HIPAA](10-gdpr-ccpa-hipaa.md)                          | What does each law require of an LLM application, and what does the gateway cover of it?          |
| [Data protection tools](20-data-protection-tools.md)                   | Which methods and settings export, correct, erase or keep less of a user's data, with samples?    |
| [Data protection best practices](30-data-protection-best-practices.md) | How do I combine them: send the model less, contract first, delete on a schedule, erase reliably? |

Start with the first page for the duties, the second for the code, the third for the process.
