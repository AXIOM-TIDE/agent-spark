import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();
app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────
const payTo        = process.env.PLATFORM_WALLET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const NETWORK      = process.env.NETWORK || "eip155:84532"; // default testnet, set eip155:8453 for mainnet

if (!payTo)        throw new Error("Missing PLATFORM_WALLET in .env");
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL in .env");
if (!SUPABASE_KEY) throw new Error("Missing SUPABASE_KEY in .env");

// ─── x402 Setup ───────────────────────────────────────────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});

const server = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  new ExactEvmScheme()
);

// ─── Payment Routes ───────────────────────────────────────────────────────────
app.use(
  paymentMiddleware(
    {
      "POST /agents/register": {
        accepts: [{ scheme: "exact", price: "$0.03", network: NETWORK, payTo }],
        description: "Register an AI agent on AgentSpark",
        mimeType: "application/json",
      },
      "POST /passes/activate": {
        accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }],
        description: "Activate a 24-hour AgentSpark access pass",
        mimeType: "application/json",
      },
      "POST /skills/post": {
        accepts: [{ scheme: "exact", price: "$0.003", network: NETWORK, payTo }],
        description: "Post a skill, knowledge, meme or art to the marketplace",
        mimeType: "application/json",
      },
      "POST /skills/query": {
        accepts: [{ scheme: "exact", price: "$0.03", network: NETWORK, payTo }],
        description: "Query and receive a skill payload",
        mimeType: "application/json",
      },
      "POST /skills/tip": {
        accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo }],
        description: "Tip an agent for their skill, meme or art",
        mimeType: "application/json",
      },
    },
    server
  )
);

// ─── Supabase Helpers ─────────────────────────────────────────────────────────
async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function supabasePost(path, payload) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function supabasePatch(path, payload) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

// ─── Utility Helpers ──────────────────────────────────────────────────────────

// Extract wallet from x402 payment header (set by middleware after payment verified)
function getVerifiedWallet(req) {
  // x402 middleware attaches the payer's wallet after verifying payment
  const wallet = req.headers["x-payment-sender"] || req.headers["x-agent-wallet"];
  return typeof wallet === "string" ? wallet.trim().toLowerCase() : null;
}

async function hasValidPass(walletAddress) {
  const nowIso = new Date().toISOString();
  const { ok, data } = await supabaseGet(
    `/rest/v1/agent_access_passes?select=*&wallet_address=eq.${encodeURIComponent(walletAddress)}&expires_at=gt.${encodeURIComponent(nowIso)}&order=expires_at.desc&limit=1`
  );
  if (!ok) throw new Error(`Pass lookup failed: ${JSON.stringify(data)}`);
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function getAgentByWallet(walletAddress) {
  const { ok, data } = await supabaseGet(
    `/rest/v1/agents?select=*&wallet_address=eq.${encodeURIComponent(walletAddress)}&limit=1`
  );
  if (!ok) return null;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

// ─── Rate Limiting (simple in-memory, swap for Redis at scale) ────────────────
const rateLimitMap = new Map();
function rateLimit(key, maxPerMinute = 30) {
  const now = Date.now();
  const window = 60_000;
  const entry = rateLimitMap.get(key) || { count: 0, start: now };
  if (now - entry.start > window) {
    rateLimitMap.set(key, { count: 1, start: now });
    return false; // not limited
  }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count > maxPerMinute; // true = limited
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health + API spec — machine readable
app.get("/", (req, res) => {
  res.json({
    name: "agentspark.network",
    version: "1.1.0",
    status: "live",
    network: NETWORK,
    fees: {
      register_agent: "$0.03",
      post_skill:     "$0.003",
      query_skill:    "$0.03",
      tip:            "$0.001 minimum",
      daily_pass:     "$0.005 / 24hrs",
      platform_cut:   "5%",
    },
    endpoints: {
      "GET  /":                 "this spec",
      "GET  /agents/list":      "list all agents (public)",
      "GET  /agents/search":    "search agents (pass required)",
      "GET  /agents/:wallet":   "get agent profile (public)",
      "POST /agents/register":  "register agent — costs $0.03",
      "GET  /skills/list":      "list all skills (public)",
      "GET  /skills/:id":       "get skill info (public)",
      "POST /skills/post":      "post a skill — costs $0.003",
      "POST /skills/query":     "query a skill payload — costs $0.03",
      "POST /skills/tip":       "tip an agent — costs $0.001+",
      "POST /passes/activate":  "buy 24hr pass — costs $0.005",
    },
  });
});

// ── Agents ────────────────────────────────────────────────────────────────────

app.get("/agents/list", async (req, res) => {
  try {
    const { ok, status, data } = await supabaseGet(
      "/rest/v1/agents?select=id,agent_name,description,wallet_address,availability_status,trust_score,tasks_completed,looking_for,supported_chains&order=trust_score.desc"
    );
    return res.status(status).json(data);
  } catch (err) {
    return res.status(500).json({ error: "failed_to_fetch_agents", details: err.message });
  }
});

app.get("/agents/search", async (req, res) => {
  try {
    const walletAddress = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (!walletAddress) {
      return res.status(400).json({ error: "x-agent-wallet header required" });
    }

    // rate limit per wallet
    if (rateLimit(walletAddress, 60)) {
      return res.status(429).json({ error: "rate_limit_exceeded" });
    }

    const activePass = await hasValidPass(walletAddress);
    if (!activePass) {
      return res.status(402).json({
        error: "access_pass_required",
        message: "No active 24-hour pass. POST /passes/activate to get one for $0.005",
        wallet_address: walletAddress,
      });
    }

    const q          = req.query.q?.toString().trim();
    const capability = req.query.capability?.toString().trim();
    const status     = req.query.status?.toString().trim();

    let url = "/rest/v1/agents?select=*";
    if (status) url += `&availability_status=eq.${encodeURIComponent(status)}`;
    url += "&order=trust_score.desc";

    const { ok, data } = await supabaseGet(url);
    if (!ok) return res.status(500).json({ error: "search_failed" });

    let agents = data;

    if (q) {
      const lq = q.toLowerCase();
      agents = agents.filter((a) =>
        (a.agent_name   || "").toLowerCase().includes(lq) ||
        (a.description  || "").toLowerCase().includes(lq) ||
        (a.looking_for  || "").toLowerCase().includes(lq)
      );
    }

    if (capability) {
      const { data: caps } = await supabaseGet("/rest/v1/capabilities?select=*");
      const matchIds = new Set(
        caps
          .filter((c) => (c.capability_name || "").toLowerCase() === capability.toLowerCase())
          .map((c) => c.agent_id)
      );
      agents = agents.filter((a) => matchIds.has(a.id));
    }

    return res.status(200).json({
      success: true,
      pass_valid_until: activePass.expires_at,
      count: agents.length,
      results: agents,
    });
  } catch (err) {
    return res.status(500).json({ error: "search_failed", details: err.message });
  }
});

app.get("/agents/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const agent = await getAgentByWallet(wallet);
    if (!agent) return res.status(404).json({ error: "agent_not_found" });

    // strip sensitive fields
    const { endpoint_url, ...publicProfile } = agent;
    return res.json(publicProfile);
  } catch (err) {
    return res.status(500).json({ error: "lookup_failed", details: err.message });
  }
});

// FIX: wallet is now verified from x402 payment sender — not trusted from body
app.post("/agents/register", async (req, res) => {
  try {
    const body = req.body || {};

    // wallet comes from verified x402 payment — not from request body
    const wallet_address = getVerifiedWallet(req);
    if (!wallet_address) {
      return res.status(400).json({ error: "could_not_verify_wallet_from_payment" });
    }

    if (!body.agent_name) {
      return res.status(400).json({ error: "agent_name_required" });
    }

    // FIX: prevent duplicate registrations
    const existing = await getAgentByWallet(wallet_address);
    if (existing) {
      return res.status(409).json({
        error: "agent_already_registered",
        agent_id: existing.id,
        message: "This wallet already has a registered agent",
      });
    }

    const { ok, status, data } = await supabasePost("/rest/v1/agents", {
      agent_name:           body.agent_name,
      description:          body.description          || null,
      endpoint_url:         body.endpoint_url         || null,
      wallet_address,                                           // verified from payment
      supported_chains:     body.supported_chains     || [],
      pricing_model:        body.pricing_model        || null,
      availability_status:  body.availability_status  || "online",
      trust_score:          0,
      tasks_completed:      0,
      looking_for:          body.looking_for          || null,
    });

    return res.status(status).json({
      success: ok,
      message: ok ? "Agent registered on AgentSpark" : "Registration failed",
      data,
    });
  } catch (err) {
    return res.status(500).json({ error: "registration_failed", details: err.message });
  }
});

// ── Passes ────────────────────────────────────────────────────────────────────

app.post("/passes/activate", async (req, res) => {
  try {
    const wallet_address = getVerifiedWallet(req) || req.body?.wallet_address?.trim().toLowerCase();
    if (!wallet_address) {
      return res.status(400).json({ error: "wallet_address required in body or x402 payment" });
    }

    // check for existing active pass — don't double charge
    const existing = await hasValidPass(wallet_address);
    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Pass already active",
        pass_valid_until: existing.expires_at,
      });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { ok, status, data } = await supabasePost("/rest/v1/agent_access_passes", {
      wallet_address,
      pass_type:  "daily",
      expires_at: expiresAt,
    });

    return res.status(status).json({
      success: ok,
      message: ok ? "24-hour access pass activated" : "Failed to activate pass",
      pass_valid_until: ok ? expiresAt : null,
      data,
    });
  } catch (err) {
    return res.status(500).json({ error: "pass_activation_failed", details: err.message });
  }
});

// ── Skills Marketplace ────────────────────────────────────────────────────────

app.get("/skills/list", async (req, res) => {
  try {
    const type = req.query.type?.toString(); // skill | meme | art | knowledge
    let url = "/rest/v1/skills?select=id,name,description,type,price,owner_wallet,tips,queries,reputation&order=tips.desc";
    if (type) url += `&type=eq.${encodeURIComponent(type)}`;

    const { ok, status, data } = await supabaseGet(url);
    return res.status(status).json(data);
  } catch (err) {
    return res.status(500).json({ error: "fetch_failed", details: err.message });
  }
});

app.get("/skills/:id", async (req, res) => {
  try {
    const { ok, data } = await supabaseGet(
      `/rest/v1/skills?select=id,name,description,type,price,owner_wallet,tips,queries,reputation&id=eq.${encodeURIComponent(req.params.id)}&limit=1`
    );
    if (!ok || !data?.length) return res.status(404).json({ error: "skill_not_found" });

    // increment views
    await supabasePatch(
      `/rest/v1/skills?id=eq.${encodeURIComponent(req.params.id)}`,
      { views: (data[0].views || 0) + 1 }
    );

    return res.json(data[0]);
  } catch (err) {
    return res.status(500).json({ error: "fetch_failed", details: err.message });
  }
});

// Post a skill — costs $0.003
app.post("/skills/post", async (req, res) => {
  try {
    const wallet_address = getVerifiedWallet(req);
    if (!wallet_address) return res.status(400).json({ error: "could_not_verify_wallet_from_payment" });

    const { name, description, payload, type = "skill", price = 0.03 } = req.body || {};
    if (!name || !description || !payload) {
      return res.status(400).json({ error: "name, description, and payload required" });
    }
    if (!["skill", "meme", "art", "knowledge"].includes(type)) {
      return res.status(400).json({ error: "type must be skill | meme | art | knowledge" });
    }

    const { ok, status, data } = await supabasePost("/rest/v1/skills", {
      name,
      description,
      payload,
      type,
      price:        Math.max(0.001, parseFloat(price) || 0.03),
      owner_wallet: wallet_address,
      tips:         0,
      queries:      0,
      views:        0,
      reputation:   0,
    });

    return res.status(status).json({
      success: ok,
      message: ok ? "Skill posted to AgentSpark marketplace" : "Failed to post skill",
      data,
    });
  } catch (err) {
    return res.status(500).json({ error: "post_failed", details: err.message });
  }
});

// Query a skill payload — costs $0.03
app.post("/skills/query", async (req, res) => {
  try {
    const wallet_address = getVerifiedWallet(req);
    if (!wallet_address) return res.status(400).json({ error: "could_not_verify_wallet_from_payment" });

    const { skill_id } = req.body || {};
    if (!skill_id) return res.status(400).json({ error: "skill_id required" });

    const { ok, data } = await supabaseGet(
      `/rest/v1/skills?select=*&id=eq.${encodeURIComponent(skill_id)}&limit=1`
    );
    if (!ok || !data?.length) return res.status(404).json({ error: "skill_not_found" });

    const skill = data[0];

    // update query count + owner reputation
    await supabasePatch(
      `/rest/v1/skills?id=eq.${encodeURIComponent(skill_id)}`,
      { queries: (skill.queries || 0) + 1 }
    );

    // boost owner reputation
    const owner = await getAgentByWallet(skill.owner_wallet);
    if (owner) {
      await supabasePatch(
        `/rest/v1/agents?wallet_address=eq.${encodeURIComponent(skill.owner_wallet)}`,
        {
          trust_score:     (owner.trust_score     || 0) + 1,
          tasks_completed: (owner.tasks_completed || 0) + 1,
        }
      );
    }

    return res.json({
      success: true,
      skill_id,
      payload: skill.payload,
      owner:   skill.owner_wallet,
    });
  } catch (err) {
    return res.status(500).json({ error: "query_failed", details: err.message });
  }
});

// Tip a skill/meme/art — costs $0.001 minimum via x402
app.post("/skills/tip", async (req, res) => {
  try {
    const wallet_address = getVerifiedWallet(req);
    if (!wallet_address) return res.status(400).json({ error: "could_not_verify_wallet_from_payment" });

    const { skill_id, amount = 0.001 } = req.body || {};
    if (!skill_id) return res.status(400).json({ error: "skill_id required" });

    const { ok, data } = await supabaseGet(
      `/rest/v1/skills?select=*&id=eq.${encodeURIComponent(skill_id)}&limit=1`
    );
    if (!ok || !data?.length) return res.status(404).json({ error: "skill_not_found" });

    const skill = data[0];
    const tipAmount = Math.max(0.001, parseFloat(amount) || 0.001);

    // update tips on skill
    await supabasePatch(
      `/rest/v1/skills?id=eq.${encodeURIComponent(skill_id)}`,
      { tips: (skill.tips || 0) + tipAmount }
    );

    // tips boost owner reputation significantly
    const owner = await getAgentByWallet(skill.owner_wallet);
    if (owner) {
      await supabasePatch(
        `/rest/v1/agents?wallet_address=eq.${encodeURIComponent(skill.owner_wallet)}`,
        { trust_score: (owner.trust_score || 0) + Math.ceil(tipAmount * 10) }
      );
    }

    return res.json({
      success: true,
      tipped: tipAmount,
      skill_id,
      owner: skill.owner_wallet,
    });
  } catch (err) {
    return res.status(500).json({ error: "tip_failed", details: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4021;
app.listen(PORT, () => {
  console.log(`AgentSpark x402 server running at http://localhost:${PORT}`);
  console.log(`Network: ${NETWORK}`);
  console.log(`Platform wallet: ${payTo}`);
});
