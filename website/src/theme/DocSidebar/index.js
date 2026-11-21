// Wraps the theme's doc sidebar (swizzle "wrap", not eject) so a sidebar link to a heading, e.g. the API tree's
// `/docs/api/index/classes/AIGateway#getfileurl`, is highlighted on that URL and its categories opened.
//
// The problem: Docusaurus marks an item active when its href equals `path`, the page's pathname. A heading link never
// does: the pathname has no `#hash`, and a `link` item's href lacks the baseUrl (`/dyna-ai-gateway/`), added only when
// the link renders.
//
// The fix: the link hrefs get the baseUrl here (`Link` never adds it twice), and when a link points at the current
// pathname + hash, its href is passed as `path`, so Docusaurus's own logic highlights it and opens every category above.
// Otherwise `path` stays the pathname and the doc entries are active as before.
import React, {useMemo} from "react";
import {useLocation} from "@docusaurus/router";
import {useBaseUrlUtils} from "@docusaurus/useBaseUrl";
import useIsBrowser from "@docusaurus/useIsBrowser";
import DocSidebar from "@theme-original/DocSidebar";

export default function DocSidebarWithHeadingLinks(props) {
  const {pathname, hash} = useLocation();
  const {withBaseUrl} = useBaseUrlUtils();
  // The server renders without the hash; using it only after hydration keeps the first client render identical
  const isBrowser = useIsBrowser();
  const sidebar = useMemo(() => withBaseUrlOnLinks(props.sidebar, withBaseUrl), [props.sidebar, withBaseUrl]);
  // GitHub Pages serves `…/AIGateway/` (a folder's index.html), the sidebar href is `…/AIGateway#…`
  const linkHref = isBrowser && hash ? findLinkHref(sidebar, `${pathname.replace(/\/$/, "")}${hash}`) : undefined;
  return <DocSidebar {...props} sidebar={sidebar} path={linkHref ?? props.path} />;
}

/** A copy of the items with the baseUrl on every `link` href; nested categories included. */
const withBaseUrlOnLinks = (items, withBaseUrl) => items.map((item) => {
  if (item.type === "link") return {...item, href: withBaseUrl(item.href)};
  if (item.type === "category") return {...item, items: withBaseUrlOnLinks(item.items, withBaseUrl)};
  return item;
});

/** The href of the first `link` item, at any depth, equal to `href` ignoring case (as Docusaurus compares); else undefined. */
const findLinkHref = (items, href) => {
  for (const item of items) {
    if (item.type === "link" && item.href.toLowerCase() === href.toLowerCase()) return item.href;
    const nested = item.type === "category" ? findLinkHref(item.items, href) : undefined;
    if (nested) return nested;
  }
  return undefined;
};
