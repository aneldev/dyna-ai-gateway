---
sidebar_label: GDPR, CCPA and HIPAA
description: "GDPR, CCPA and HIPAA for LLM applications: the LLM provider's role, deadlines, fines, and which duties an AI gateway covers and which stay with the application."
keywords: [GDPR, LLM GDPR, CCPA, CPRA, HIPAA, HIPAA LLM, PHI, AI compliance, LLM privacy, AI gateway, right to erasure, data retention, zero data retention, DPA, BAA, EU AI Act, personal data]
---

# GDPR, CCPA and HIPAA for LLM Applications: What an AI Gateway Covers and What Stays Yours

An application that puts a language model in front of its users sends personal data to an LLM provider and stores
conversations, remembered facts and logs of model calls. The EU General Data Protection Regulation (GDPR), the California
Consumer Privacy Act (CCPA, as amended by the CPRA) and the US Health Insurance Portability and Accountability Act
(HIPAA) are the three laws that shape most of that work in Europe and the United States. This guide states what each
requires, maps each duty to what the gateway does, and lists what stays the application's job. The gateway's tools,
with samples, are on [Data protection tools](20-data-protection-tools.md); how to combine them is on
[Best practices](30-data-protection-best-practices.md).

This page is technical documentation, not legal advice. The legal facts were checked against the sources linked in each
section on 20 November 2026; laws, regulations and provider terms change, and the application's counsel decides how they
apply to it.

## 1. The three laws at a glance

| Question                             | GDPR (EU)                                                 | CCPA / CPRA (California)                                | HIPAA (US health care)                                          |
|--------------------------------------|-----------------------------------------------------------|---------------------------------------------------------|-----------------------------------------------------------------|
| Whose data                           | Any identifiable person, where the GDPR applies (Art. 3)  | California residents ("consumers")                      | Protected health information (PHI) of patients and plan members |
| Who must comply                      | Controllers and processors                                | Businesses over the thresholds, their service providers | Covered entities and their business associates                  |
| The application is usually           | The controller                                            | The business                                            | A covered entity, or a business associate of one                |
| The LLM provider is usually          | A processor (Art. 28 contract)                            | A service provider or contractor (contract required)    | A business associate when it receives PHI (BAA required)        |
| Deadline to answer an access request | One month, extendable by two (Art. 12(3))                 | 45 days, extendable by 45 (§1798.130)                   | 30 days, extendable by 30 (§164.524)                            |
| Right to erasure                     | Yes (Art. 17)                                             | Yes, right to delete (§1798.105)                        | No general right; access and amendment                          |
| Breach notification                  | Authority within 72 hours (Art. 33)                       | Residents within 30 days (Civ. Code §1798.82)           | Individuals within 60 days (§164.404)                           |
| Highest fine                         | EUR 20 million or 4% of turnover, the higher (Art. 83(5)) | USD 7,988 per intentional violation (§1798.155)         | USD 2,190,294 per year and provision (§160.404, §102.3)         |

## 2. Where personal data goes in an AI gateway

Each law asks what is collected, where it is kept and who receives it.

### 2.1 What the gateway stores

The gateway has no database of its own. Every record goes through a repository or adapter that the application passes in
the config; the in-memory ones that ship are for development and tests
([the ten seams](../60-architecture/20-adapters.md#the-ten-seams)). The ones that hold personal data:

| Seam                    | What it keeps about a user                                                                                                                               |
|-------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `IThreadRepository`     | The user's threads, every turn (prompt and answer), the thread memory                                                                                    |
| `IUserMemoryRepository` | The facts remembered about the user, across threads                                                                                                      |
| `IRunRepository`        | The runs that paused, with their request and messages; they stay after they end, until deleted                                                           |
| `ITraceRepository`      | One entry per model call: the request as sent (system prompt, messages; files without their bytes) and the result; for an embedding call, the usage only |
| `IBlobAdapter`          | The bytes of the files the user uploaded                                                                                                                 |
| `IVectorIndexAdapter`   | The knowledge-base chunks: whatever personal data the application's documents contain                                                                    |

The user context (`IUserContext`: tenant, user, permissions, locale, time zone, now) is supplied on every call and is not
stored as a record: its `tenantId` and `userId` key the records, and its locale, time zone and date are part of the system
prompt that runs and trace entries keep. A prompt that fails an input rule of the guardrails creates no turn; when a judge
checked it, the trace entry of that judge call holds it.

### 2.2 What the LLM provider receives

A model call sends the system prompt and the messages. The system prompt holds the instructions, the call's context, the
locale, time zone and date, the user's remembered facts, the thread memory and the knowledge-base excerpts; the
messages hold the history, the new prompt, the tool calls and their results, and the files of the question.

Other calls send content too: the extraction of user facts, the thread-memory summary, the rewrite of a follow-up
question, every guardrail judge ([the judge](../20-learn-the-gateway/050-guardrails.md#25-the-judge)), and the embedding
of a knowledge-base search query and of a document at ingestion.

What the provider keeps of it, and for how long, is set by the provider's terms ([section 7](#7-the-llm-providers-terms)).
The gateway's erasure methods remove the application's copies; they do not reach the provider's.

## 3. GDPR

The GDPR is Regulation (EU) 2016/679, applicable since 25 May 2018
([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)). The article numbers below refer to it.

### 3.1 Scope and roles

- It applies to an organisation established in the EU, and to one outside the EU that offers goods or services to people
  in the EU or monitors their behaviour (Art. 3).
- Personal data is any information about an identified or identifiable person, the data subject (Art. 4(1)). A prompt, a
  chat history, a remembered fact and a trace entry are personal data when they relate to one.
- The controller decides why and how data is processed (Art. 4(7)); a processor processes it on the controller's behalf
  (Art. 4(8)). The application's company is the controller of its users' conversations. An LLM provider that processes
  prompts on its instructions is a processor and needs a contract with the terms of Art. 28(3); its own sub-processors
  need the controller's prior authorisation (Art. 28(2), 28(4)).
- Every processing needs a legal basis of Art. 6(1), such as consent, a contract or legitimate interests, and the people
  are told about it when their data is collected (Art. 13), or at the latest within one month when it comes from elsewhere, such as the
  documents of a knowledge base (Art. 14).
- Health data, biometric data and the other special categories may be processed only under an exception of Art. 9(2).
  Users can type such data into a chat without being asked.

### 3.2 Principles: purpose, minimisation, storage limitation

Data is collected for specified purposes, limited to what is necessary, and kept in identifiable form no longer than
those purposes need (Art. 5(1)(b), (c), (e)). Data protection by design and by default (Art. 25) asks that the settings
collect the least by default.

What the gateway gives:

- The two memories are switches without a default: `workingMemory.enabled` and `userMemoryStore.enabled` must be set in
  the config ([the switch](../20-learn-the-gateway/090-user-memory.md#21-the-switch)).
- With user memory on, the background extraction stores the facts it finds without asking. The model's remember tool
  stores a fact only after the user approves it, unless `rememberNeedsApproval` is set to `false`
  ([D116](../60-architecture/90-decisions.md#d116-the-model-cannot-write-a-user-fact-unasked)).
- A trace entry holds the request as sent. An `ITraceRepository` that must not keep it drops the `request` and the
  `result` in `save`.

What it does not give: a retention period. No store has a time to live, and no method selects by age. Deleting old data
on a schedule is the application's job: it picks the old thread ids in its repositories and passes them to `delete`,
which removes their turns, files, runs and trace entries; trace entries without a thread are deleted in its own trace
repository.

### 3.3 Data subject rights

The controller answers a request within one month, extendable by two further months for complex or numerous requests,
with the person told of the extension within the first month (Art. 12(3)).

| Right                                    | Article | What the gateway gives                                                                                                                                                                                 |
|------------------------------------------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Access                                   | 15      | `listThreads`, `getTurns`, `getUserFacts`, `getThreadMemory`; `trace.query` by `userId`; `listPausedRuns`, `getPausedRun`; ended runs and files: the application's `IRunRepository` and `IBlobAdapter` |
| Rectification                            | 16      | `upsertUserFact`, `removeUserFact`; turns are a record of what was said and are not edited                                                                                                             |
| Erasure                                  | 17      | `deleteUserData`; `anonymizeUserData` when the counts and cost must stay ([section 3.6](#36-anonymized-or-pseudonymised))                                                                              |
| Restriction                              | 18      | Nothing specific; the application stops calling the gateway for the user                                                                                                                               |
| Portability                              | 20      | The access methods return structured data; the export format is the application's                                                                                                                      |
| Not to be subject to automated decisions | 22      | A human review of the answer before the user sees it (`reviewAnswers`) and approvals on tools (`approvals`)                                                                                            |

`deleteUserData` erases what the gateway holds about the user in one tenant
([Erase a user](20-data-protection-tools.md#erase-a-user)). Two limits:

- It waits for the calls and the background work of its own instance. A call of the user running on another instance
  makes it fail with status 409 and `data.busyThreadIds` before anything is erased; a call that starts on another
  instance during the erasure, or a memory update still queued there, is not stopped. With several instances, the
  application blocks the user's traffic (for example, suspends the account), lets the other instances finish their calls
  and background work before each attempt, then erases, and retries on a 409.
- It does not reach the application's usage adapter (`IUsageAdapter`), the knowledge base (it has no user: a document
  goes with `kbIngestor.removeDocument`), the application's own logs and backups, or the LLM provider's copies.

### 3.4 Security, breaches and impact assessments

- Art. 32 asks for security appropriate to the risk, naming pseudonymisation and encryption as measures. The gateway
  encrypts nothing at rest: encryption is a property of the databases behind the application's repositories and adapters.
- Isolation: every store of user or tenant data reads and deletes by `tenantId`, and the user's reads (`listThreads`,
  `getTurns`) return only the calling user's threads. `trace`, `getPausedRun`, `delete`, `deleteUserData` and
  `anonymizeUserData` take raw ids: the application checks who may call them.
- A breach is notified to the supervisory authority within 72 hours of becoming aware of it, unless it is unlikely to
  result in a risk (Art. 33), and to the people affected when the risk is high (Art. 34). A processor tells the controller
  without undue delay (Art. 33(2)).
- The controller keeps a record of its processing (Art. 30) and runs a data protection impact assessment before processing
  that is likely to result in a high risk (Art. 35).

### 3.5 Transfers to an LLM provider outside the EU

Personal data leaves the European Economic Area only under an adequacy decision (Art. 45) or appropriate safeguards such
as the standard contractual clauses (Art. 46;
[Decision (EU) 2021/914](https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj)).

For the United States, the EU-US Data Privacy Framework is an adequacy decision for the US companies certified under it
([Decision (EU) 2023/1795](https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj)). The General Court dismissed an action
for its annulment on 3 September 2025 (case T-553/23, *Latombe v Commission*); the judgment was appealed to the Court of
Justice (case C-703/25 P). The decision applies until a court or the Commission sets it aside. A provider's EU region or
EU data zone keeps processing in Europe where the provider offers one ([section 7](#7-the-llm-providers-terms)).

### 3.6 Anonymized or pseudonymised

Pseudonymised data, which can be attributed to a person with additional information, is still personal data; anonymous
data, which no longer identifies anyone by any means reasonably likely to be used, is outside the GDPR (Recital 26,
Art. 4(5)). The Court of Justice held that pseudonymised data may not be personal data for a recipient that cannot
reasonably re-identify the people, while it stays personal data for the controller that can (case C-413/23 P,
*EDPS v SRB*, 4 September 2025, decided under Regulation (EU) 2018/1725, whose concept of personal data matches the
GDPR's; [press release](https://curia.europa.eu/site/upload/docs/application/pdf/2025-09/cp250107en.pdf)). The
controller's duty to inform about the recipients applies at collection, whatever the recipient can identify.

`anonymizeUserData` removes what identifies the person and keeps the threads, runs and trace entries as skeletons
under one random pseudonym, which only its result carries
([Anonymize instead of delete](20-data-protection-tools.md#anonymize-instead-of-delete)). An application that keeps it holds pseudonymised data; whether the skeletons are anonymous without it
is the controller's assessment.

### 3.7 AI models and newer guidance

- The European Data Protection Board's [Opinion 28/2024](https://www.edpb.europa.eu/our-work-tools/our-documents/opinion-board-art-64/opinion-282024-certain-data-protection-aspects_en)
  (18 December 2024) treats legitimate interest as a possible legal basis for developing and deploying AI models, under a
  three-step test, and holds that a model is anonymous only when identifying people from it, or extracting their data
  through queries, is very unlikely.
- On 8 July 2026 the EDPB adopted, for public consultation, guidelines on anonymization and on web scraping for
  generative AI ([EDPB](https://www.edpb.europa.eu/news/edpb-sheds-light-on-anonymization-and-web-scraping-for-generative-ai-and-adopts-final-version_en)).
- The "Digital Omnibus" that would amend the GDPR is a proposal of the Commission (COM(2025) 837, procedure
  [2025/0360(COD)](https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2025%2F0360%28COD%29)), not law.
- In the United Kingdom, the UK GDPR applies as amended by the
  [Data (Use and Access) Act 2025](https://www.legislation.gov.uk/ukpga/2025/18/contents), which replaces Art. 22 on
  automated decisions with Art. 22A-22D; most of its data protection provisions apply since 5 February 2026
  ([GOV.UK](https://www.gov.uk/guidance/data-use-and-access-act-2025-plans-for-commencement)).

## 4. CCPA / CPRA

The California Consumer Privacy Act, amended by the California Privacy Rights Act, is Civil Code §1798.100 and following,
with regulations in Title 11 of the California Code of Regulations. The California Privacy Protection Agency (CPPA)
enforces it ([CPPA](https://cppa.ca.gov/faq.html)), and the Attorney General may bring civil actions (§1798.199.90).

### 4.1 Who must comply

A for-profit business that does business in California is covered when it has annual gross revenue over USD 26,625,000
(the threshold since 1 January 2025), buys, sells or shares the personal information of 100,000 or more consumers or
households, or makes half of its revenue from selling or sharing it (§1798.140(d);
[CPPA adjustments](https://www.cppa.ca.gov/regulations/cpi_adjustment.html)).

### 4.2 Consumer rights

Consumers may know what is collected (§1798.110), delete it (§1798.105), correct it (§1798.106), opt out of its sale or
sharing (§1798.120) and limit the use of sensitive personal information (§1798.121). The business answers a request to
know, delete or correct within 45 days, extendable once by 45 with notice within the first 45 (§1798.130;
[Attorney General](https://oag.ca.gov/privacy/ccpa)). The gateway's methods for each are those of the GDPR rights in
[section 3.3](#33-data-subject-rights).

A business that sells or shares personal information honours an opt-out preference signal such as Global Privacy Control
as a valid opt-out ([11 CCR §7025](https://www.law.cornell.edu/regulations/california/11-CCR-7025)).

### 4.3 The LLM provider as a service provider

A sale or a sharing is a disclosure to a third party, and a service provider or contractor is not a third party
(§1798.140(ai)). A service provider receives personal information for a business purpose under a written contract that
forbids selling or sharing it and using it for other purposes (§1798.140(ag);
[11 CCR §7051](https://www.law.cornell.edu/regulations/california/11-CCR-7051)(a) lists the terms). The provider may not retain, use or disclose the personal information except for the purposes of the
contract; it may use it to improve its own service only when it does not use it to perform services for another business
([11 CCR §7050](https://www.law.cornell.edu/regulations/california/11-CCR-7050)(a)(3)). A vendor without such a contract
is not a service provider, and the disclosure to it may be a sale or sharing, with the opt-out that requires (§7050(e)). Whether a provider's use of prompts to
train models fits these purposes depends on whether it serves other businesses with them; the provider's terms on
training ([section 7](#7-the-llm-providers-terms)) are the point to check.

### 4.4 Automated decision-making, risk assessments and audits

The CPPA's regulations on automated decision-making technology (ADMT), risk assessments and cybersecurity audits were
approved on 22 September 2025 and are effective since 1 January 2026
([CPPA](https://cppa.ca.gov/regulations/ccpa_updates.html)). A business that uses a model to make a
significant decision about a consumer falls under the ADMT requirements; the human review of the answer
(`reviewAnswers`) and the approvals on tools (`approvals`) are the gateway's places for a person in that decision
([human in the loop](../20-learn-the-gateway/040-human-in-the-loop.md#23-the-review-of-the-answer)).

### 4.5 Breaches and penalties

- A consumer whose unencrypted and unredacted personal information is breached through the business's failure to keep
  reasonable security may sue for USD 107 to 799 per consumer and incident, or actual damages if greater (§1798.150).
- Administrative fines are up to USD 2,663 per violation and USD 7,988 per intentional violation or one involving a
  consumer the business knows is under 16 (§1798.155, §1798.199.90). The amounts are those in force since 1 January 2025
  ([CPPA](https://www.cppa.ca.gov/regulations/cpi_adjustment.html)).
- California's breach notification law asks, since 1 January 2026, that affected residents are notified within 30
  calendar days of discovering the breach (later only when law enforcement needs it, or to determine the scope and
  restore the system), and that the Attorney General receives a sample notice within 15 days of that notice when more
  than 500 residents are affected ([Civ. Code §1798.82](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82)).

### 4.6 Other US laws

- There is no federal comprehensive privacy law. The
  [IAPP](https://iapp.org/news/a/new-year-new-rules-us-state-privacy-requirements-coming-online-as-2026-begins) counted
  19 states with a comprehensive privacy law enacted as of January 2026, and more states enacted one in 2026. Most give
  the rights of [section 4.2](#42-consumer-rights) with their own thresholds and deadlines.
- The Federal Trade Commission acts against deceptive or unfair AI practices under the FTC Act
  ([Operation AI Comply](https://www.ftc.gov/news-events/news/press-releases/2024/09/ftc-announces-crackdown-deceptive-ai-claims-schemes),
  September 2024), and has ordered the deletion of models built on improperly obtained data
  ([Everalbum](https://www.ftc.gov/news-events/news/press-releases/2021/05/ftc-finalizes-settlement-photo-app-developer-related-misuse-facial-recognition-technology),
  2021).
- The amended COPPA Rule on children under 13 has a compliance date of 22 April 2026
  ([Federal Register](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule)).

## 5. HIPAA

HIPAA's Privacy, Security and Breach Notification Rules are 45 CFR Parts 160 and 164
([eCFR](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C)).

### 5.1 Covered entities and business associates

Covered entities are health plans, health care clearinghouses and health care providers that transmit health
information electronically in standard transactions. A business associate creates, receives, maintains or transmits
protected health information (PHI) on a covered entity's behalf; a subcontractor does so for a business associate
(§160.103). A company that runs an application for a covered entity and handles its PHI is a business associate. An LLM
provider that receives PHI in prompts is a business associate or subcontractor in turn, and may receive PHI only under a
business associate agreement (BAA). The "conduit" exception covers transmission-only services; HHS treats a service that
stores PHI as a business associate
([HHS cloud computing guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html)).

### 5.2 De-identified data

De-identified data is not PHI. It is de-identified either by an expert's documented determination that the risk of
identification is very small, or by removing the 18 identifiers of the Safe Harbor method (names, geographic units smaller
than a state, dates other than the year, contact details, record and account numbers, device identifiers, URLs, IP
addresses, biometrics, full-face photos and any other unique code) without actual knowledge that the rest identifies
the person (§164.514(a)-(b)).

The gateway has no built-in rule that detects identifiers, and no rule removes them from a prompt: a rule passes, warns
or blocks. An application that must keep PHI from the provider adds an input rule (`inputRules`) that blocks it, or
removes the identifiers before the call.

### 5.3 Individual rights

A covered entity acts on a request for access within 30 days, extendable once by 30 (§164.524), and on a request for
amendment within 60 days, extendable once by 30 (§164.526). HIPAA gives no general right to erasure; the gateway's
erasure methods serve the covered entity's own retention policy and the contract with it. The use and disclosure of PHI
is limited to the minimum necessary (§164.502(b), §164.514(d)): what the system prompt and the knowledge base hand the
model is the place to apply it.

### 5.4 Security Rule

The technical safeguards of §164.312 are access control, audit controls, integrity, person or entity authentication and
transmission security. The gateway's part: every store of user or tenant data is scoped by tenant, the user's own data also by user, and the
trace keeps one entry per model call with the model, the usage and the cost, which serves audit. Authentication,
encryption at rest and in transit, and the audit of who read the stores are the application's and its databases'.

A proposed update of the Security Rule was published on 6 January 2025 (90 FR 898) and is not final; the regulatory agenda
lists it as a long-term action, with a final action planned for July 2027 ([reginfo.gov](https://www.reginfo.gov/public/do/eAgendaViewRule?RIN=0945-AA22)).

### 5.5 Breaches and penalties

A covered entity notifies affected individuals without unreasonable delay and no later than 60 calendar days after
discovering a breach (§164.404); a business associate notifies the covered entity on the same terms (§164.410).

Civil penalties per violation, at the amounts in force for 2026
([45 CFR §102.3](https://www.ecfr.gov/current/title-45/part-102/section-102.3); HHS made no adjustment for 2026):

| Culpability                               | Minimum per violation | Maximum per violation | Yearly cap per provision |
|-------------------------------------------|-----------------------|-----------------------|--------------------------|
| Did not know                              | USD 145               | USD 73,011            | USD 2,190,294            |
| Reasonable cause                          | USD 1,461             | USD 73,011            | USD 2,190,294            |
| Willful neglect, corrected within 30 days | USD 14,602            | USD 73,011            | USD 2,190,294            |
| Willful neglect, not corrected            | USD 73,011            | USD 2,190,294         | USD 2,190,294            |

Since April 2019, as a matter of enforcement discretion and pending further rulemaking, HHS applies a separate, lower
yearly cap to each of the first three tiers ([84 FR 18151](https://www.govinfo.gov/content/pkg/FR-2019-04-30/html/2019-08530.htm));
the table shows the caps of the regulation.

## 6. The EU AI Act: tell people they talk to an AI

The AI Act (Regulation (EU) 2024/1689) requires the provider of an AI system that interacts directly with people to make
sure they are informed that they are interacting with an AI, unless that is obvious from the context (Art. 50(1)); it
applies since 2 August 2026 ([European Commission](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)).
A breach of Art. 50 is fined up to EUR 15 million or 3% of worldwide annual turnover, whichever is higher (Art. 99(4)).
The notice is part of the application's interface; the gateway does not show it.

## 7. The LLM providers' terms

Each provider below states the following on its own pages, checked on 20 November 2026. Terms change, and they often
differ per product, tier, model and endpoint: the contract the application signs is what applies.

| Provider       | What its pages state                                                                                                                                                                                                                                                                                                                    | Sources                                                                                                                                                                                                                                                |
|----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| OpenAI         | API data is not used for training unless the customer opts in; abuse-monitoring logs up to 30 days; zero data retention on approval; a BAA for eligible endpoints                                                                                                                                                                       | [Your data](https://developers.openai.com/api/docs/guides/your-data)                                                                                                                                                                                   |
| Anthropic      | API inputs and outputs deleted within 30 days, except the Files API, a zero data retention agreement, Usage Policy enforcement (flagged content up to 2 years) and the law; Covered Models need limited retention and review; a BAA for the first-party API, without the Batch API, Files API, Skills API, Code Execution and Web Fetch | [Retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [BAA](https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers)                             |
| Google Gemini  | Paid use is not used to improve products; outside the EEA, Switzerland and the UK, unpaid use is, with human review; data may be processed in any country where Google has facilities                                                                                                                                                   | [Gemini API terms](https://aistudio.google.com/docs/terms)                                                                                                                                                                                             |
| Vertex AI      | Data is not used for training without permission; a regional endpoint keeps its cache in the chosen location, the global endpoint may serve from any region; Google Cloud signs a BAA, and its HIPAA list names Generative AI on Agent Platform                                                                                         | [Data governance](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance), [HIPAA](https://docs.cloud.google.com/docs/security/compliance/hipaa)                                                                                   |
| Mistral        | Data hosted in the European Union; `api.eu.mistral.ai` and `api.us.mistral.ai` pin the region of inference, `api.mistral.ai` does not; a DPA referring to the SCCs                                                                                                                                                                      | [Storage](https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data), [Regional inference](https://docs.mistral.ai/inference/regional-inference), [DPA](https://legal.mistral.ai/terms/data-processing-addendum) |
| Amazon Bedrock | Prompts are not shared with the model providers; a retention mode per Region, `none` for zero retention, except models that require `aws_review` (kept up to 30 days); a HIPAA-eligible service                                                                                                                                         | [Data retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html), [HIPAA](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/)                                                                              |
| Azure OpenAI   | Data is not used to train models; processing stays in the chosen geography unless a Global or DataZone deployment is used; an EU DataZone processes within the EU                                                                                                                                                                       | [Data privacy](https://learn.microsoft.com/azure/ai-foundry/responsible-ai/openai/data-privacy)                                                                                                                                                        |

## 8. What stays the application's job

The gateway gives the erasure, the scoping, the switches and the human review. The rest is the application's:

- [ ] Name the legal basis of each purpose (GDPR Art. 6, Art. 9 for special categories), tell the users, and keep a record
      of the processing (Art. 30).
- [ ] Sign the provider's DPA (GDPR), service-provider terms (CCPA) or BAA (HIPAA) before the first real prompt; pick the
      tier, region and retention that do not train on the data and keep it where it must stay.
- [ ] For a provider outside the EEA, rely on its Data Privacy Framework certification or the standard contractual
      clauses.
- [ ] Decide whether user memory is on for the gateway, and whether the remember tool asks first.
- [ ] Set a retention period and delete old threads, runs and trace entries on a schedule; drop the trace `request` where
      it must not be kept.
- [ ] Wire the access, correction and erasure requests to the gateway's methods, per tenant, and keep the deadlines.
- [ ] With several instances, block the user's calls, let the other instances finish their calls and background work
      before each attempt, and retry on a 409.
- [ ] Erase what the gateway does not hold: the usage adapter's records, logs, backups, analytics, the documents of the
      knowledge base, and the provider's copies where its terms allow it.
- [ ] Keep PHI out of prompts that no BAA covers, and special categories out unless an Art. 9(2) exception applies: block
      them with an input rule or remove them before the call.
- [ ] Put a person in significant automated decisions (`reviewAnswers`, `approvals`; GDPR Art. 22, CCPA ADMT).
- [ ] Honour Global Privacy Control where the business sells or shares personal information.
- [ ] Encrypt the databases behind the repositories and adapters, and control who may read them and the trace.
- [ ] Prepare breach notification: 72 hours (GDPR), 30 days and 15 days to the Attorney General (California), 60 days
      (HIPAA).
- [ ] Tell people they talk to an AI (AI Act Art. 50).
- [ ] Run a data protection impact assessment, a CCPA risk assessment or a HIPAA risk analysis where the law asks for one.
