// TEMP shim so tsc can check the edge function without Deno installed.
// It only has to be shape-compatible enough to catch real mistakes in our code
// (wrong argument counts, wrong property names, missing returns).
declare module "npm:@supabase/supabase-js@2" {
  /**
   * A query builder, typed as `any` at the point it resolves to data.
   *
   * The real SDK returns per-table row types generated from the schema, which a
   * hand-written shim cannot reproduce. What the shim does need to get right is
   * the SHAPE of the chain: the filter methods return the builder, so
   * `.select().eq().in().order()` is one awaited value, and that value is `any`.
   *
   * Typing it as a bare `any` would instead make `.select()` an `any` call whose
   * arguments — including a `.map(row => …)` callback — have no contextual type,
   * and every callback parameter would be reported as an implicit `any`. That
   * would be a defect in the shim showing up as a defect in the functions.
   */
  export interface QueryBuilder {
    select(columns?: string): QueryBuilder;
    insert(values: unknown): QueryBuilder;
    update(values: unknown): QueryBuilder;
    delete(): QueryBuilder;
    upsert(values: unknown): QueryBuilder;
    eq(column: string, value: unknown): QueryBuilder;
    neq(column: string, value: unknown): QueryBuilder;
    in(column: string, values: readonly unknown[]): QueryBuilder;
    is(column: string, value: unknown): QueryBuilder;
    order(column: string, opts?: { ascending?: boolean }): QueryBuilder;
    limit(n: number): QueryBuilder;
    range(from: number, to: number): QueryBuilder;
    maybeSingle(): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>;
    single(): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>;
    then<T = any>(
      onfulfilled?: (value: { data: any; error: { message: string; code?: string } | null }) => T
    ): PromiseLike<T>;
  }

  export interface SupabaseClient {
    from(table: string): QueryBuilder;
    // Used by the logo assignment path to run its one batched statement.
    rpc(
      fn: string,
      args?: Record<string, unknown>
    ): Promise<{ data: any; error: { message: string; code?: string } | null }>;
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
        // Used to read a logo's bytes out of the private bucket at render time.
        download(path: string): Promise<{ data: Blob; error: { message: string } | null }>;
      };
    };
  }
  export function createClient(url: string, key: string, opts?: unknown): SupabaseClient;
}

// Both spellings of the CDN import resolve to the module above, so the shim is
// declared twice rather than the functions having to agree on one of them.
declare module "https://esm.sh/@supabase/supabase-js@2" {
  export * from "npm:@supabase/supabase-js@2";
}

/**
 * The platform's `CompressionStream` / `DecompressionStream` are declared as
 * `GenericTransformStream`, whose writable side accepts `BufferSource`. This
 * alias keeps `pdfImage.ts` readable without pretending the narrower
 * `TransformStream<Uint8Array, Uint8Array>` is assignable to it — it is not,
 * because `BufferSource` includes `ArrayBuffer`.
 */
interface GenericTransformStream extends TransformStream<any, Uint8Array> {}

declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
}
