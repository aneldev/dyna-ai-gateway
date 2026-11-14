// Wraps the theme's footer link (swizzle "wrap", not eject): the original still renders the link, its baseUrl handling
// and its external-link mark; this only puts the Material icon the item names in `icon` (see ./icons.js) before it.
// `icon` is removed from the item, since the original spreads every other key onto the <a>.
import React from "react";
import FooterLinkItem from "@theme-original/Footer/LinkItem";
import {footerIcons} from "./icons";

export default function FooterLinkItemWithIcon({item}) {
  const {icon, ...link} = item;
  const paths = icon ? footerIcons[icon] : undefined;
  if (!paths) return <FooterLinkItem item={link} />;
  return (
    <span className="footer__link-row">
      <svg className="footer__link-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {paths.map((d) => <path key={d} d={d} />)}
      </svg>
      <FooterLinkItem item={link} />
    </span>
  );
}
