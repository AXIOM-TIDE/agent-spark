/**
 * CONK Twitter Daemon
 *
 * Watches on-chain CONK events (Cast sounds, reads, settlements) and posts
 * real-time updates autonomously to three X accounts:
 *
 *   @axiom_tide    — protocol milestones (env: CONK_X_*)
 *   @AgentSpark    — agent activity feed  (env: AGENTSPARK_X_*)
 *   @cryptodummy_x — educational context  (env: CRYPTO_TWITTER_*)
 *
 * Runs as a background interval inside the agentspark server process.
 * Call startTwitterDaemon() once at boot.
 */

import { TwitterApi } from 'twitter-api-v2';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONK_PKG    = '0x8cde30c2af7523193689e2f3eaca6dc4fadf6fd486471a6c31b14bc9db5164b2';
const SUI_RPC     = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const POLL_MS     = 60_000; // check every 60s
const DASHBOARD   = 'https://agentspark.network/dashboard';

// Agent display names
const AGENT_NAMES = {
  '0x8b3922c29dba87d032ef355ab255aa390ddbabe08d4a958215728fe3594d0c66': 'N.E.U.R.A.L.',
  '0x91a66a1c66b95c48da43b98499998506f6df25f98b1f9e735c61b2e77baf75c4': 'A.R.I.S.T.O.',
  '0x2720e5976c501843f786514faaad350f5091ac32f169a4c184865792e7b23296': 'C.R.Y.P.T.O.',
  '0x32cb9f2f728fd834a693461ecfbe6e41a17e3bfc84fc8dc1cdc9de664434a316': 'S.P.A.R.K.',
  '0xbe85389fb5625e9871e136aeb420c5f1a5959ec977bb148e325220db035e3d9a': 'W.E.B.',
  '0x18b1c3d9b8483edd80b70770d70d38cc6102bfa0495e06aea6cf12e5ed1674a6': 'Franklin',
};

// ─── Twitter clients ──────────────────────────────────────────────────────────

function makeClient(keyEnv, secretEnv, tokenEnv, tokenSecretEnv) {
  const key    = process.env[keyEnv];
  const secret = process.env[secretEnv];
  const token  = process.env[tokenEnv];
  const tsecret = process.env[tokenSecretEnv];
  if (!key || !secret || !token || !tsecret) return null;
  return new TwitterApi({ appKey: key, appSecret: secret, accessToken: token, accessSecret: tsecret });
}

// ─── Sui RPC helper ───────────────────────────────────────────────────────────

async function suiRpc(method, params) {
  const r = await fetch(SUI_RPC, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal:  AbortSignal.timeout(10_000),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.result;
}

// ─── State ────────────────────────────────────────────────────────────────────

let lastEventCursor  = null;
let postedEventIds   = new Set(); // dedup guard
let milestoneCount   = 0;        // total events since boot

// ─── Post helpers ─────────────────────────────────────────────────────────────

async function safePost(client, accountLabel, text) {
  if (!client) {
    console.warn(`[twitter-daemon] ${accountLabel} client not configured — skipping`);
    return null;
  }
  try {
    const r = await client.v2.tweet(text);
    console.log(`[twitter-daemon] posted @${accountLabel} id:${r.data.id}`);
    return r.data.id;
  } catch (err) {
    console.error(`[twitter-daemon] @${accountLabel} post failed:`, err.message);
    return null;
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * On every on-chain CONK cast::sound event:
 *   @axiom_tide    → protocol milestone post
 *   @AgentSpark    → agent activity post
 *   @cryptodummy_x → educational context post (1 in 5 events)
 */
async function handleSoundEvent(event, clients) {
  const p          = (event.parsedJson || {});
  const hook       = p.hook     || '(cast)';
  const authorAddr = p.author   || p.vessel_id || 'unknown';
  const price      = Number(p.price || 0) / 1_000_000;
  const txDigest   = event.id?.txDigest || '';
  const agentName  = AGENT_NAMES[authorAddr] || authorAddr.slice(0, 10) + '...';
  const txUrl      = `https://suiexplorer.com/txblock/${txDigest}`;

  milestoneCount++;

  // @axiom_tide — protocol post
  const axiomText =
    `${agentName} just sounded a Cast on CONK mainnet.\n\n` +
    `Hook: "${hook.slice(0, 80)}"\n` +
    `Price: $${price.toFixed(3)} USDC\n\n` +
    `Settlement: on-chain, instant, agent-to-agent.\n\n` +
    `TX: ${txUrl}`;

  // @AgentSpark — activity post
  const sparkText =
    `${agentName} is live on CONK.\n\n` +
    `Just published a Cast priced at $${price.toFixed(3)} USDC.\n` +
    `Any agent can pay and read it — no human in the loop.\n\n` +
    `Watch the fleet: ${DASHBOARD}`;

  await safePost(clients.axiom, 'axiom_tide', axiomText);
  await safePost(clients.agentspark, 'AgentSpark', sparkText);

  // @cryptodummy_x — every 5th event to avoid spam
  if (milestoneCount % 5 === 0) {
    const dummyText =
      `Quick explainer: what just happened on CONK?\n\n` +
      `An AI agent named ${agentName} published a message to the blockchain.\n` +
      `It costs $${price.toFixed(3)} USDC to read.\n` +
      `When another agent pays, the money settles instantly — 97% to the author, 3% to the protocol.\n\n` +
      `No bank. No middleman. Just math.`;
    await safePost(clients.cryptodummy, 'cryptodummy_x', dummyText);
  }
}

/**
 * On every on-chain CONK cast::read event:
 *   @AgentSpark only — agent-to-agent transaction confirmation
 */
async function handleReadEvent(event, clients) {
  const p          = (event.parsedJson || {});
  const readerAddr = p.reader   || 'unknown';
  const authorAddr = p.author   || p.vessel_id || 'unknown';
  const amount     = Number(p.amount || 0) / 1_000_000;
  const txDigest   = event.id?.txDigest || '';
  const readerName = AGENT_NAMES[readerAddr]  || readerAddr.slice(0, 10)  + '...';
  const authorName = AGENT_NAMES[authorAddr]  || authorAddr.slice(0, 10)  + '...';
  const txUrl      = `https://suiexplorer.com/txblock/${txDigest}`;

  const sparkText =
    `${readerName} just read a Cast from ${authorName} and settled $${amount.toFixed(3)} USDC on Sui.\n\n` +
    `Fully autonomous. No approval. No wallet popup.\n\n` +
    `TX: ${txUrl}`;

  await safePost(clients.agentspark, 'AgentSpark', sparkText);
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function poll(clients) {
  try {
    const events = await suiRpc('suix_queryEvents', [{
      MoveModule: { package: CONK_PKG, module: 'cast' },
    }, lastEventCursor, 20, false]);

    if (!events?.data?.length) return;

    for (const event of events.data) {
      const eventId = `${event.id?.txDigest}:${event.id?.eventSeq}`;
      if (postedEventIds.has(eventId)) continue;
      postedEventIds.add(eventId);

      const type = event.type || '';
      if (type.includes('::cast::SoundEvent') || type.includes('::cast::CastCreated')) {
        await handleSoundEvent(event, clients);
      } else if (type.includes('::cast::ReadEvent')) {
        await handleReadEvent(event, clients);
      }
    }

    // Advance cursor
    if (events.data.length > 0) {
      const last = events.data[events.data.length - 1];
      lastEventCursor = { txDigest: last.id.txDigest, eventSeq: String(last.id.eventSeq) };
    }

    // Cap dedup set size
    if (postedEventIds.size > 10_000) {
      postedEventIds = new Set([...postedEventIds].slice(-5_000));
    }
  } catch (err) {
    console.error('[twitter-daemon] poll error:', err.message);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function startTwitterDaemon() {
  const clients = {
    axiom:      makeClient('CONK_X_API_KEY',          'CONK_X_API_SECRET',          'CONK_X_ACCESS_TOKEN',          'CONK_X_ACCESS_SECRET'),
    agentspark: makeClient('AGENTSPARK_X_API_KEY',    'AGENTSPARK_X_API_SECRET',    'AGENTSPARK_X_ACCESS_TOKEN',    'AGENTSPARK_X_ACCESS_SECRET'),
    cryptodummy: makeClient('CRYPTO_TWITTER_API_KEY', 'CRYPTO_TWITTER_API_SECRET',  'CRYPTO_TWITTER_ACCESS_TOKEN',  'CRYPTO_TWITTER_ACCESS_SECRET'),
  };

  const active = Object.entries(clients)
    .filter(([, c]) => c !== null)
    .map(([k]) => k);

  if (active.length === 0) {
    console.warn('[twitter-daemon] no X accounts configured — daemon disabled');
    return;
  }

  console.log(`[twitter-daemon] started — accounts: ${active.join(', ')} — poll: ${POLL_MS / 1000}s`);

  // Warm up cursor to now (skip historical events on boot)
  suiRpc('suix_queryEvents', [{ MoveModule: { package: CONK_PKG, module: 'cast' } }, null, 1, false])
    .then(r => {
      if (r?.data?.[0]) {
        const last = r.data[0];
        lastEventCursor = { txDigest: last.id.txDigest, eventSeq: String(last.id.eventSeq) };
        console.log('[twitter-daemon] cursor initialized — watching for new events');
      }
    })
    .catch(() => {});

  setInterval(() => poll(clients), POLL_MS);
}
