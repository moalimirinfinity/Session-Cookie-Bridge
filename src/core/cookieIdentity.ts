import type { CookieRecordV2 } from "../shared/types";

function partitionKeyPart(record: CookieRecordV2): string {
  const topLevelSite = record.partitionKey?.topLevelSite ?? "";
  const hasCrossSiteAncestor = record.partitionKey?.hasCrossSiteAncestor === true ? "1" : "0";
  return `${topLevelSite}|${hasCrossSiteAncestor}`;
}

export function cookieIdentityKey(record: CookieRecordV2): string {
  return `${record.name}|${record.domain}|${record.path}|${record.storeId}|${partitionKeyPart(record)}`;
}
