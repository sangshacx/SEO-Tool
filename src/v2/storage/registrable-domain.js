import { isValidBacklinkDomain } from "../backlinks/domain.js";
import {
  PUBLIC_SUFFIX_EXACT_RULES,
  PUBLIC_SUFFIX_EXCEPTION_RULES,
  PUBLIC_SUFFIX_WILDCARD_RULES,
} from "./public-suffix-list.generated.js";

const EXACT_RULES = new Set(PUBLIC_SUFFIX_EXACT_RULES);
const WILDCARD_RULES = new Set(PUBLIC_SUFFIX_WILDCARD_RULES);
const EXCEPTION_RULES = new Set(PUBLIC_SUFFIX_EXCEPTION_RULES);

function normalizeHostname(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0]
    : "";
}

function suffixLabelCount(labels) {
  let longest = 1; // PSL prevailing default rule: "*".
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = labels.slice(index).join(".");
    if (EXCEPTION_RULES.has(candidate)) return labels.length - index - 1;
    if (EXACT_RULES.has(candidate)) longest = Math.max(longest, labels.length - index);
    if (index > 0 && WILDCARD_RULES.has(candidate)) {
      longest = Math.max(longest, labels.length - index + 1);
    }
  }
  return longest;
}

export function normalizeRegistrableDomain(value) {
  // Do not strip a leading "www" before PSL matching: some exception rules
  // (notably !www.ck) make it semantically significant.
  const hostname = normalizeHostname(value);
  if (!isValidBacklinkDomain(hostname)) return null;

  const labels = hostname.split(".");
  const suffixLength = suffixLabelCount(labels);
  if (labels.length <= suffixLength) return null;
  return labels.slice(-(suffixLength + 1)).join(".");
}
