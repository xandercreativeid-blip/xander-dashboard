// Kelola akun anggota tim tanpa email: anggota tim yang sudah login bisa membuatkan akun (atau mengganti
// password) untuk email yang ada di daftar team_members. Tidak bergantung pada layanan email Supabase,
// jadi tidak ada batas jumlah undangan per jam.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function allUsers() {
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    out.push(...data.users);
    if (data.users.length < 1000) return out;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // Hanya anggota tim yang sudah login.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const { data: who } = await sb.auth.getUser(token);
    const me = who?.user?.email?.toLowerCase();
    if (!me) return json({ error: "Please sign in first." }, 401);
    const { data: team, error: teamErr } = await sb.from("team_members").select("email").order("email");
    if (teamErr) throw new Error(teamErr.message);
    const emails = (team || []).map((t: any) => t.email);
    if (!emails.includes(me)) return json({ error: "Only team members can manage accounts." }, 403);

    const body = await req.json().catch(() => ({}));
    const users = await allUsers();
    const byEmail = new Map(users.map((u: any) => [String(u.email || "").toLowerCase(), u]));

    if (body.action === "list") {
      return json({ members: emails.map((e: string) => {
        const u = byEmail.get(e);
        return { email: e, account: !!u, confirmed: !!u?.email_confirmed_at, last_sign_in_at: u?.last_sign_in_at || null };
      }) });
    }
    if (body.action === "set_password") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!emails.includes(email)) return json({ error: "Add this email to the team list and save first." }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      const u = byEmail.get(email);
      if (u) {
        const { error } = await sb.auth.admin.updateUserById(u.id, { password, email_confirm: true });
        if (error) throw new Error(error.message);
        return json({ ok: true, created: false });
      }
      const { error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw new Error(error.message);
      return json({ ok: true, created: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message) }, 500);
  }
});
