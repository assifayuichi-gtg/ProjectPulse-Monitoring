import { RequestError, describeChange, searchWork } from "./changes.mjs";

const origin = "https://assifayuichi-gtg.github.io";
const site = origin + "/ProjectPulse-Monitoring/";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const life = 10 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });

type Proposal = {
  revision: number;
  issuedAt: number;
  changeId: string;
  input: { kind: string; id: string; patch: Record<string, unknown> };
};

async function signingKey(serviceKey: string) {
  return crypto.subtle.importKey(
    "raw", encoder.encode("projectpulse-chatgpt-approval-v1:" + serviceKey),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

async function sign(proposal: Proposal, serviceKey: string) {
  const payload = base64url(encoder.encode(JSON.stringify(proposal)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(serviceKey), encoder.encode(payload));
  return payload + "." + hex(signature);
}

async function verify(token: unknown, serviceKey: string): Promise<Proposal> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,16000}\.[a-f0-9]{64}$/.test(token)) {
    throw new RequestError("Usulan tidak valid.");
  }
  const [payload, signature] = token.split(".");
  const bytes = Uint8Array.from(signature.match(/../g)!, (part) => parseInt(part, 16));
  if (!await crypto.subtle.verify("HMAC", await signingKey(serviceKey), bytes, encoder.encode(payload))) {
    throw new RequestError("Tanda tangan usulan tidak valid.", 403);
  }
  const proposal = JSON.parse(decoder.decode(Uint8Array.from(
    atob(payload.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0),
  )));
  if (Date.now() >= proposal.issuedAt + life) throw new RequestError("Usulan sudah kedaluwarsa.", 410);
  return proposal;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS" && req.headers.get("Origin") === origin) {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") return json({ error: "Gunakan POST." }, 405);
  const operation = new URL(req.url).pathname.split("/").pop();
  const fromGPT = operation === "search" || operation === "propose";
  if (!fromGPT && operation !== "review" && operation !== "apply") {
    return json({ error: "Operasi tidak tersedia." }, 404);
  }
  const key = Deno.env.get("PROJECTPULSE_CHATGPT_ACTION_KEY");
  if (!key || !/^[a-f0-9]{64}$/.test(key)) return json({ error: "Integrasi belum diaktifkan." }, 503);
  const accessToken = req.headers.get("Authorization")?.match(/^Bearer (\S{1,8192})$/i)?.[1];
  if (!accessToken) return json({ error: "Autentikasi diperlukan." }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    let actor: string | undefined;
    if (fromGPT) {
      const digest = (value: string) => crypto.subtle.digest("SHA-256", encoder.encode(value));
      const [actual, expected] = await Promise.all([digest(accessToken), digest(key)]);
      const actualBytes = new Uint8Array(actual);
      const expectedBytes = new Uint8Array(expected);
      let difference = 0;
      for (let index = 0; index < 32; index++) {
        difference |= actualBytes[index] ^ expectedBytes[index];
      }
      if (difference) return json({ error: "Kunci Action tidak valid." }, 401);
    } else {
      const response = await fetch(url + "/auth/v1/user", {
        headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: "Bearer " + accessToken },
      });
      if (!response.ok) return json({ error: "Login admin ProjectPulse diperlukan." }, 401);
      const user = await response.json();
      if (user.app_metadata?.projectpulse_role !== "admin") {
        return json({ error: "Akun tidak memiliki akses admin ProjectPulse." }, 403);
      }
      actor = user.id;
    }

    let input;
    try {
      const raw = await req.text();
      if (raw.length > 22000) return json({ error: "Permintaan terlalu besar." }, 413);
      input = JSON.parse(raw);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    } catch {
      return json({ error: "JSON tidak valid." }, 400);
    }

    const dbHeaders = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
    const response = await fetch(url + "/rest/v1/projectpulse_state?singleton=eq.true&select=payload,revision", {
      headers: dbHeaders,
    });
    if (!response.ok) throw new Error("Snapshot read failed");
    const [state] = await response.json();
    if (!state || !Number.isSafeInteger(state.revision)) {
      throw new RequestError("Snapshot ProjectPulse belum tersedia.", 409);
    }
    if (operation === "search") return json(searchWork(state.payload, input));
    if (operation === "propose") {
      const { kind, id, patch } = input;
      const proposal: Proposal = {
        revision: state.revision, issuedAt: Date.now(), changeId: crypto.randomUUID(),
        input: { kind, id, patch },
      };
      const { preview } = describeChange(state.payload, proposal.input, new Date(proposal.issuedAt));
      const token = await sign(proposal, serviceKey);
      if (token.length > 16065) return json({ error: "Usulan terlalu besar." }, 413);
      return json({
        status: "awaiting_admin_approval", preview,
        approvalUrl: site + "#chatgpt=" + token,
        expiresAt: new Date(proposal.issuedAt + life).toISOString(),
      });
    }

    const proposal = await verify(input.token, serviceKey);
    const list = Array.isArray(state.payload.activity) ? state.payload.activity : [];
    if (list.some((entry) => entry?.id === proposal.changeId && entry?.source === "chatgpt")) {
      return json({ status: "already_applied" });
    }
    if (state.revision !== proposal.revision) {
      throw new RequestError("Data cloud berubah. Buat usulan baru dari ChatGPT.", 409);
    }
    const { item, updated, preview } = describeChange(
      state.payload, proposal.input, new Date(proposal.issuedAt),
    );
    if (operation === "review") return json({ status: "awaiting_admin_approval", preview });

    const items = proposal.input.kind === "task" ? "tasks" : "subs";
    if (preview.changes.pic) {
      // Existing PIC links authorize updates by item ID. Require the coordinator
      // to revoke links for the previous assignment before changing the PIC.
      for (let offset = 0; ; offset += 100) {
        const query = new URLSearchParams({
          select: "payload", revoked_at: "is.null", submitted_at: "is.null",
          expires_at: "gt." + new Date().toISOString(), limit: "100",
          order: "id.asc", offset: String(offset),
        });
        const linksResponse = await fetch(url + "/rest/v1/projectpulse_pic_links?" + query, { headers: dbHeaders });
        if (!linksResponse.ok) throw new Error("PIC link lookup failed");
        const links = await linksResponse.json();
        if (links.some((link) => Array.isArray(link.payload?.items) && link.payload.items.some((entry) =>
          items === "tasks" ? entry.taskId === item.id
            : entry.id === item.id || entry.subId === item.id))) {
          throw new RequestError("Batalkan tautan PIC aktif untuk pekerjaan ini di Data & Backup, lalu setujui lagi.", 409);
        }
        if (links.length < 100) break;
      }
    }
    const payload = {
      ...state.payload,
      [items]: state.payload[items].map((entry) => entry === item ? updated : entry),
      activity: [{
        id: proposal.changeId, source: "chatgpt", approvedBy: actor,
        date: new Date().toISOString(), msg: "Perubahan ChatGPT disetujui: " + updated.name,
        target: { kind: proposal.input.kind, id: item.id }, changes: preview.changes,
      }, ...list].slice(0, 30),
    };
    const write = await fetch(url + "/rest/v1/rpc/projectpulse_put_state", {
      method: "POST", headers: { ...dbHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ p_payload: payload, p_expected_revision: proposal.revision }),
    });
    if (!write.ok) throw new Error("Snapshot write failed");
    const [committed] = await write.json();
    if (!committed) throw new RequestError("Data cloud berubah. Buat usulan baru dari ChatGPT.", 409);
    return json({ status: "applied", revision: committed.revision });
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    return json({ error: "ProjectPulse tidak bisa memproses permintaan." }, 500);
  }
});
