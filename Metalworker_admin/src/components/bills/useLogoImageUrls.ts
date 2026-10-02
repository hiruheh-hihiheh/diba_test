// src/components/bills/useLogoImageUrls.ts
//
// Signed URLs for logo images, fetched as a set.
//
// WHY IT FETCHES ITS OWN URL
// The `invoice-logos` bucket is private, so there is no permanent address for a
// logo's image. Each consumer would otherwise mint its own signed URL, which means
// N requests for the same picture and N chances for them to expire at different
// moments. This fetches one URL per logo for the whole set it is asked about.
//
// THE URLS ARE NOT CACHED ACROSS RE-RENDERS
// Signed URLs are short-lived and the set changes as the admin works, so caching
// them would mean holding URLs that quietly stop working. One fetch per change of
// set is the right amount of work: the library is small, and a stale-until-
// refreshed image is worse than a fetch.
//
// A FAILURE IS NOT AN ERROR
// A preview that cannot load resolves to an empty map rather than throwing. The
// logo's name and its bill count are on screen and still actionable, and the real
// failure surfaces properly the moment anyone prints.

import { useEffect, useState } from "react";

import { getLogoImageUrls } from "../../services/invoiceLogos";

export function useLogoImageUrls(logoIds: readonly string[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());

  /* The ids are joined into a sorted string so the effect keys on WHICH logos are
     wanted rather than on the identity of the array. Without this, a caller that
     builds its array inline — which is every list — would re-fetch on every render.
     Sorting makes the key order-independent too, so the same set in a different
     order is recognised as the same set. */
  const key = [...new Set(logoIds.filter(Boolean))].sort().join(",");

  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    if (wanted.length === 0) return;

    let cancelled = false;
    getLogoImageUrls(wanted)
      .then((next) => {
        if (!cancelled) setUrls(next);
      })
      .catch(() => {
        if (!cancelled) setUrls(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return urls;
}

export default useLogoImageUrls;