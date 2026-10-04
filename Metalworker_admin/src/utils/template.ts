// src/utils/template.ts
//
// SUBSTITUTION FOR THE SETTINGS SCREEN'S PREVIEW ONLY.
//
// READ THIS BEFORE CHANGING ANYTHING HERE
// The authoritative implementation is
// `supabase/functions/process-bill-upload/_shared/businessProfile.ts` -> fillTemplate().
// That is the one that decides what a PDF prints, because that is where PDFs are
// made. This file exists so an admin editing a term can SEE the finished sentence
// without generating an invoice, and nothing else depends on it.
//
// It is a deliberate, accepted duplication across a hard architectural boundary.
// The two clients bundle from their own `src/` trees and cannot import from the
// Edge Function folder, and importing one dependency-free module out of it would
// put an unlinted, untypechecked file inside the app bundle. Ten duplicated lines,
// each pointing at the original, is the cheaper mistake than that.
//
// The rule below therefore matches the server's exactly, and both are pinned by
// tests. If they ever disagree, the SERVER is right and this file is the bug.

/**
 * The variables a stored profile string may use.
 *
 * Two, deliberately. A template engine is a thing that can be got wrong, and the
 * only reason for one is that an admin should not have to re-type "40" in five
 * places to change the payment window. Anything wider would be a language nobody
 * asked for, and every extra token is another way for a financial document to
 * print something unintended.
 */
export const TEMPLATE_VARIABLES = ["PAYMENT_DAYS", "COMPANY_NAME"] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export interface TemplateValues {
  PAYMENT_DAYS?: number | null;
  COMPANY_NAME?: string | null;
}

/**
 * Fill the supported variables in one string, for previewing.
 *
 * Two rules, and both are about not putting nonsense on an invoice:
 *
 *   An UNSUPPORTED `{FOO}` is left exactly as it is. Printing it verbatim makes a
 *   configuration mistake visible on the page; silently deleting it makes a
 *   sentence quietly lose a clause, and nobody reviewing the invoice would know a
 *   clause was meant to be there.
 *
 *   A SUPPORTED variable with no value is also left as it is, rather than replaced
 *   with an empty string. `{PAYMENT_DAYS}` with no payment window set would
 *   otherwise preview as "Payment requested within  DAYS", which is not a sentence
 *   anyone can pay by - and the preview showing exactly that broken sentence is
 *   the clearest possible signal that the window is missing.
 *
 * Nothing here throws. An unknown variable cannot break the screen, which is the
 * guarantee both copies are tested for.
 */
export function previewTemplate(text: string | null | undefined, values: TemplateValues): string {
  if (!text) return "";
  return text.replace(/\{([A-Z_]+)\}/g, (whole, name: string) => {
    if (name !== "PAYMENT_DAYS" && name !== "COMPANY_NAME") return whole;
    const value = values[name];
    if (value === null || value === undefined || value === "") return whole;
    return String(value);
  });
}

/**
 * True when a string still contains something the renderer will not be able to
 * fill - an unsupported variable, or a supported one with no value.
 *
 * Used by the settings screen to warn while typing, which is the moment a warning is
 * useful. It is advisory only: it never blocks a save, because a stored string with
 * a placeholder in it is a legitimate state to be in the middle of editing.
 */
export function templateHasUnresolved(text: string | null | undefined, values: TemplateValues): boolean {
  if (!text) return false;
  const filled = previewTemplate(text, values);
  return filled.includes("{");
}