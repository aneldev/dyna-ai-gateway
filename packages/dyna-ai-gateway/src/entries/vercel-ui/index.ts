/*
 * The public API of "dyna-ai-gateway/vercel-ui": the gateway for Vercel chat clients (D40). Server-only; composes an
 * `AIGateway` the application built. The root barrel does not re-export it: the gateway's own API never names a chat
 * client's types.
 */

export * from "./AIGatewayVercelUi";
export * from "./UiMapper";
export * from "./types";
