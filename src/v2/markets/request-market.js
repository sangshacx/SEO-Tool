import { findLanguage, isSupportedMarket } from "./catalog.js";

const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = "en";

export function normalizeMarketRequest(body = {}) {
  const locationCode = body.location_code == null ? DEFAULT_LOCATION_CODE : Number(body.location_code);
  const requestedLanguage = body.language_code == null ? DEFAULT_LANGUAGE_CODE : String(body.language_code).trim();
  const language = findLanguage(requestedLanguage);

  if (!Number.isInteger(locationCode) || !language || !isSupportedMarket(locationCode, language.language_code)) {
    throw new TypeError("Unsupported market location_code/language_code combination.");
  }

  return { locationCode, languageCode: language.language_code };
}
