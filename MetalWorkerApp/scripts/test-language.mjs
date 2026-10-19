// Run with: npm run test:language
//
// Node 23.6+ (or Node 22.6+ with --experimental-strip-types) runs these
// TypeScript modules directly; they have no runtime imports beyond each other.
import test from "node:test";
import assert from "node:assert/strict";

import { translations } from "../src/constants/translations.ts";
import { dayLabel } from "../src/utils/dateFormat.ts";
import { translateReadableError } from "../src/utils/readableError.ts";

const en = translations.en;
const hi = translations.hi;

test("English and Hindi dictionaries have identical keys", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(hi).sort());
});

test("every dictionary value is non-empty", () => {
  for (const language of [en, hi]) {
    for (const [key, value] of Object.entries(language)) {
      assert.equal(typeof value, "string", `${key} should be a string`);
      assert.ok(value.trim().length > 0, `${key} should not be empty`);
    }
  }
});

test("Hindi differs from English except for the language names", () => {
  const intentionallySame = new Set(["language_english", "language_hindi"]);
  const stillEnglish = Object.keys(en).filter(
    (key) => !intentionallySame.has(key) && en[key] === hi[key],
  );
  assert.deepEqual(stillEnglish, []);
});

test("classified errors are translated", () => {
  const error = (kind) => ({ kind, retryable: true, message: "raw library text" });

  assert.equal(translateReadableError(error("offline"), hi), hi.no_connection);
  assert.equal(translateReadableError(error("timeout"), hi), hi.error_timeout);
  assert.equal(translateReadableError(error("server"), hi), hi.error_server);
  assert.equal(translateReadableError(error("auth"), hi), hi.error_auth);
  assert.equal(translateReadableError(error("permission"), hi), hi.error_permission);
  assert.equal(translateReadableError(error("notFound"), hi), hi.error_not_found);
  assert.equal(translateReadableError(error("unknown"), hi), hi.something_went_wrong);

  // The internal missing-profile sentinel still resolves to real copy.
  assert.equal(
    translateReadableError({ kind: "notFound", retryable: false, message: "no_profile" }, hi),
    hi.account_not_set_up,
  );
});

test("relative weekday names follow the selected language", () => {
  const now = new Date(2026, 9, 15, 12, 0, 0); // Thursday
  const threeDaysAgo = new Date(2026, 9, 12, 12, 0, 0); // Monday
  const iso = threeDaysAgo.toISOString();

  const english = dayLabel(iso, now, {
    today: en.today,
    yesterday: en.yesterday,
    weekdays: [
      en.weekday_sun,
      en.weekday_mon,
      en.weekday_tue,
      en.weekday_wed,
      en.weekday_thu,
      en.weekday_fri,
      en.weekday_sat,
    ],
  });
  const hindi = dayLabel(iso, now, {
    today: hi.today,
    yesterday: hi.yesterday,
    weekdays: [
      hi.weekday_sun,
      hi.weekday_mon,
      hi.weekday_tue,
      hi.weekday_wed,
      hi.weekday_thu,
      hi.weekday_fri,
      hi.weekday_sat,
    ],
  });

  assert.equal(english, "Mon");
  assert.equal(hindi, "सोम");
});
