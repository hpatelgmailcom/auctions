/**
 * registry.js — sender → parser routing.
 *
 * The single place a new email parser gets registered. Each parser module in
 * parsers/ exports { meta, matches(msg), parse(msg) } — see parsers/README
 * note in auctions/email/README.md for the authoring workflow.
 */

import * as cushmanWakefield      from './parsers/cushman_wakefield.js';
import * as marcusMillichap       from './parsers/marcus_millichap.js';
import * as auctionComEmail       from './parsers/auction_com_email.js';
import * as boulderGroup          from './parsers/boulder_group.js';
import * as colliersCentralValley from './parsers/colliers_central_valley.js';
import * as elevateNetLease       from './parsers/elevate_net_lease.js';
import * as kiserGroup            from './parsers/kiser_group.js';
import * as walletWise            from './parsers/wallet_wise.js';
import * as cbreRcm               from './parsers/cbre_rcm.js';
import * as visintainerGroup      from './parsers/visintainer_group.js';

const PARSERS = [
  cushmanWakefield,
  marcusMillichap,
  auctionComEmail,
  boulderGroup,
  colliersCentralValley,
  elevateNetLease,
  kiserGroup,
  walletWise,
  cbreRcm,
  visintainerGroup,
];

/** "CW Multifamily <Info@CWMultifamily.com>" → "info@cwmultifamily.com" */
export function normalizeAddress(from) {
  if (!from) return null;
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** First registered parser whose matches(msg) is true, else null. */
export function resolveParser(msg) {
  return PARSERS.find(p => p.matches(msg)) || null;
}

/** All registered senders — drives the Gmail search query and status UI. */
export function registeredSenders() {
  return PARSERS.map(p => ({
    slug:        p.meta.slug,
    displayName: p.meta.displayName,
    addresses:   p.meta.addresses,
  }));
}
