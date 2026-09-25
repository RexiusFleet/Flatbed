// LOCAL TESTING ONLY: serve one Edge Function's handler on a fixed port
// (Supabase's own runtime does this in production).
const [name, port] = Deno.args;
const { handler } = await import(`../supabase/functions/${name}/handler.ts`);
Deno.serve({ port: Number(port), onListen: () => {} }, handler);
