/**
 * Minimal ambient declarations for the Supabase Edge Function runtime.
 *
 * Edge functions deploy to Deno Deploy, where the `Deno` global is provided
 * by the platform. This shim lets a plain `tsc` build type-check the function
 * sources locally without pulling in the full Deno SDK. It only declares the
 * two APIs these functions actually use (`Deno.serve` and `Deno.env.get`).
 */
declare namespace Deno {
  function serve(
    handler: (req: Request) => Response | Promise<Response>
  ): void;
  const env: {
    get(key: string): string | undefined;
  };
}