// Kelola akun anggota tim tanpa email (tidak terkena batas email Supabase):
//  - signup (tanpa login): email yang SUDAH didaftarkan admin di team_members membuat akunnya sendiri dan langsung aktif.
//  - list / add / remove / set_password: hanya untuk anggota tim yang sudah login.
// Fungsi ini memeriksa login sendiri (verify_jwt dimatikan agar halaman login bisa memanggil "signup").
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const cleanEmail = (e: any) => String(e || "").trim().toLowerCase();
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function allUsers() {
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    out.push(...data.users);
    if (data.users.length < 1000) return out;
  }
}
async function teamEmails(): Promise<string[]> {
  const { data, error } = await sb.from("team_members").select("email").order("email");
  if (error) throw new Error(error.message);
  return (data || []).map((t: any) => t.email);
}
const findUser = async (email: string) => (await allUsers()).find((u: any) => String(u.email || "").toLowerCase() === email);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const emails = await teamEmails();

    // Pendaftaran mandiri: hanya email yang sudah ada di daftar tim dan belum punya akun aktif.
    if (body.action === "signup") {
      const email = cleanEmail(body.email), password = String(body.password || "");
      if (!emails.includes(email)) return json({ error: "This email is not on the team list yet. Ask a team admin to add it first." }, 403);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      const u = await findUser(email);
      if (u && u.email_confirmed_at) return json({ error: "This email already has an account. Please sign in." }, 409);
      if (u) {   // akun lama yang tertahan menunggu email konfirmasi
        const { error } = await sb.auth.admin.updateUserById(u.id, { password, email_confirm: true });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) throw new Error(error.message);
      }
      return json({ ok: true });
    }

    // Selain signup: hanya anggota tim yang sudah login.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const { data: who } = await sb.auth.getUser(token);
    const me = who?.user?.email?.toLowerCase();
    if (!me) return json({ error: "Please sign in first." }, 401);
    if (!emails.includes(me)) return json({ error: "Only team members can manage accounts." }, 403);

    if (body.action === "list") {
      const byEmail = new Map((await allUsers()).map((u: any) => [String(u.email || "").toLowerCase(), u]));
      return json({ members: emails.map((e: string) => {
        const u = byEmail.get(e);
        return { email: e, account: !!u, confirmed: !!u?.email_confirmed_at, last_sign_in_at: u?.last_sign_in_at || null };
      }) });
    }
    if (body.action === "add") {
      const list = (Array.isArray(body.emails) ? body.emails : [body.email]).map(cleanEmail).filter(validEmail);
      if (!list.length) return json({ error: "Enter a valid email address." }, 400);
      const { error } = await sb.from("team_members").upsert(list.map((email: string) => ({ email })), { onConflict: "email", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      return json({ ok: true, added: list });
    }
    if (body.action === "remove") {
      // Keluarkan dari tim: hapus dari daftar DAN hapus akun login-nya, jadi tidak bisa masuk lagi.
      const email = cleanEmail(body.email);
      if (email === me) return json({ error: "You cannot remove yourself." }, 400);
      if (!emails.includes(email)) return json({ error: "This email is not on the team list." }, 404);
      if (emails.length <= 1) return json({ error: "The team needs at least one member." }, 400);
      const { error } = await sb.from("team_members").delete().eq("email", email);
      if (error) throw new Error(error.message);
      const u = await findUser(email);
      if (u) { const { error: delErr } = await sb.auth.admin.deleteUser(u.id); if (delErr) throw new Error(delErr.message); }
      return json({ ok: true, account_deleted: !!u });
    }
    if (body.action === "set_password") {
      const email = cleanEmail(body.email), password = String(body.password || "");
      if (!emails.includes(email)) return json({ error: "Add this email to the team list first." }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      const u = await findUser(email);
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
