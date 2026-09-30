// TEMP shim so tsc can check the edge function without Deno installed.
// It only has to be shape-compatible enough to catch real mistakes in our code
// (wrong argument counts, wrong property names, missing returns).
declare module "npm:@supabase/supabase-js@2" {
  export interface SupabaseClient {
    from(table: string): any;
    auth: {
      getUser(): Promise<{ data: { user: any } | null; error: { message: string } | null }>;
    };
    storage: {
      from(bucket: string): {
        upload(
          path: string,
          body: Uint8Array,
          opts?: { contentType?: string; upsert?: boolean }
        ): Promise<{ error: { message: string } | null }>;
        remove(paths: string[]): Promise<{ error: { message: string } | null }>;
      };
    };
  }
  export function createClient(url: string, key: string, opts?: unknown): SupabaseClient;
}

declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
}
