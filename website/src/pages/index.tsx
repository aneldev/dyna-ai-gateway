import type {ReactNode} from "react";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";

import styles from "./index.module.css";

interface IFeature {
  title: string;
  text: ReactNode;
}

const DIAGRAM = ` Application / Agent                 dyna-ai-gateway                              LLM providers
┌──────────────────┐   ask()    ┌───────────────────────────────────────┐        ┌─────────────┐
│  business logic  │   run()    │  prompt assembly · history · memory   │  AI    │  OpenAI     │
│  HTTP, UI, jobs  │ ────────▶  │  knowledge base · tools · policies    │  SDK   │  Anthropic  │
│                  │ ◀────────  │  human gate · usage · guardrails      │ ─────▶ │  Google     │
│  userContext     │  events    │  trace                                │        │  Mistral    │
│  (authenticated) │  response  └──────────────────┬────────────────────┘        │  Bedrock    │
└──────────────────┘                               │ repository / adapter        └─────────────┘
                                                   ▼ interfaces
                                    in-memory · MongoDB · PostgreSQL · S3`;

const FEATURES: IFeature[] = [
  {
    title: "No provider lock-in",
    text: <>OpenAI, Anthropic, Google, Mistral and Amazon Bedrock. The model is chosen per call through the profile.</>,
  },
  {
    title: "Your data, your database",
    text: <>Every store is an interface. In-memory implementations are included.</>,
  },
  {
    title: "Tools with a policy",
    text: <><code>defineTool</code>: a function with a zod schema and a policy that allows, denies or holds each call.</>,
  },
  {
    title: "A human in the loop",
    text: <>A run pauses on a tool call or on the final answer; <code>resume()</code> takes approve, edit or reject.</>,
  },
  {
    title: "Spend in your code",
    text: <>Your usage adapter is asked before every model call and told what it used. The gateway holds no budget.</>,
  },
  {
    title: "Testable without a key",
    text: <>The agent loop runs on a scripted model, so the tests need no provider.</>,
  },
];

/**
 * Home -- the landing page of the docs site
 *
 * # About
 * The pitch of the README, the install line, the diagram and the reasons to adopt, with the way into the docs and the API.
 */
const Home = (): ReactNode => (
  <Layout description="A server-side TypeScript library that puts a language model inside a business application.">
    <header className={styles.hero}>
      <div className="container">
        <img className={styles.logo} src={useBaseUrl("/img/logo.svg")} alt="dyna AI Gateway logo" />
        <h1 className={styles.title}>dyna AI Gateway</h1>
        <p className={styles.tagline}>
          A server-side TypeScript library that puts a language model inside a business application.
          The application calls <code>ask()</code> for an answer or <code>run()</code> for an agent with tools;
          the gateway does the rest.
        </p>
        <div className={styles.actions}>
          <Link className="button button--primary button--lg" to="/docs/getting-started/README">Get started</Link>
          <Link className="button button--secondary button--lg" to="/docs/api/index/classes/AIGateway">API reference</Link>
        </div>
        <pre className={styles.install}>pnpm add dyna-ai-gateway zod</pre>
      </div>
    </header>
    <main>
      <section className="container margin-vert--xl">
        <pre className={styles.diagram}>{DIAGRAM}</pre>
      </section>
      <section className="container margin-bottom--xl">
        <div className="row">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="col col--4 margin-bottom--lg">
              <div className={styles.card}>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  </Layout>
);

export default Home;
