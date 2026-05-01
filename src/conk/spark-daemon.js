/**
 * S.P.A.R.K. Hourly Fleet Cast Daemon
 *
 * Every hour, S.P.A.R.K. sounds a Cast summarizing fleet activity:
 *   hook: "[FLEET REPORT] HH:MM UTC — N casts, $X.XX USDC settled"
 *   body: per-agent balance summary + recent activity
 *
 * This is the first real autonomous agent behavior on CONK.
 * The Cast is open, priced at $0.001, duration 24h.
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient }      from '@mysten/sui/client';
import { Transaction }    from '@mysten/sui/transactions';
import { bcs }            from '@mysten/sui/bcs';

// ─── Config ───────────────────────────────────────────────────────────────────

const SUI_RPC     = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';
const CONK_PKG    = '0x8cde30c2af7523193689e2f3eaca6dc4fadf6fd486471a6c31b14bc9db5164b2';
const ABYSS_OBJ   = '0x22d066f6337d68848e389402926b4a10424d9728744efb9e6dd0d0ca1c5921c7';
const CLOCK_OBJ   = '0x0000000000000000000000000000000000000000000000000000000000000006';
const USDC_TYPE   = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SPARK_VESSEL = '0x8b801ce16d09a505820efe35e12037cde52226c5ba6667bb5bfce4dd30420765';
const SOUND_FEE   = 1000n; // $0.001 USDC
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const CITIZENS = [
  { name: 'N.E.U.R.A.L.', addr: process.env.NEURAL_ADDR  || '0x911847f42cc7ff8e1247fb11b4b15177ab1fbe1cd88bf52073f93cf484773517' },
  { name: 'A.R.I.S.T.O.', addr: process.env.ARISTO_ADDR  || '0xe82cc80d2aad0821fd8e444971d88d1e556e3ef6a4611e58ca696a3c49f5f8d8' },
  { name: 'C.R.Y.P.T.O.', addr: process.env.CRYPTO_ADDR  || '0x5a4057ca8650d9767c9f943197ed534021f03dc3730cc03f9fc1dc59b3ede063' },
  { name: 'S.P.A.R.K.',   addr: process.env.SPARK_ADDR   || '0x813b4a05c1908c7bca965e04daee7ac319e499342fc8dc9449e3ecaeabcb4d19' },
  { name: 'W.E.B.',       addr: process.env.WEB_ADDR     || '0x03f4fea17c123897dab3ba0beee3fd6e7e55689b336c0938a949211878f9d7ae' },
];

// ─── Sui helpers ──────────────────────────────────────────────────────────────

async function suiRpc(client, method, params) {
  const url = SUI_RPC;
  const r   = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal:  AbortSignal.timeout(10_000),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.result;
}

// ─── Gather fleet data ────────────────────────────────────────────────────────

async function gatherFleetData(client) {
  const results = [];
  let totalUsdc = 0;

  for (const citizen of CITIZENS) {
    try {
      const bal = await suiRpc(client, 'suix_getBalance', [citizen.addr, USDC_TYPE]);
      const usdc = Number(bal.totalBalance || 0) / 1_000_000;
      totalUsdc += usdc;
      results.push({ name: citizen.name, usdc });
    } catch {
      results.push({ name: citizen.name, usdc: null });
    }
  }

  // Recent CONK events in last hour
  let recentCasts = 0;
  try {
    const events = await suiRpc(client, 'suix_queryEvents', [
      { MoveModule: { package: CONK_PKG, module: 'cast' } },
      null, 20, false
    ]);
    recentCasts = events?.data?.length || 0;
  } catch { /* non-fatal */ }

  return { citizens: results, totalUsdc, recentCasts };
}

// ─── Build and sign the fleet report Cast ─────────────────────────────────────

async function soundFleetReport() {
  const rawKey = process.env.SPARK_CONK_PRIVATE_KEY || '';
  if (!rawKey) {
    console.warn('[spark-daemon] SPARK_CONK_PRIVATE_KEY not set — skipping report');
    return;
  }

  const client = new SuiClient({ url: SUI_RPC });
  const kp     = rawKey.startsWith('suiprivkey')
    ? Ed25519Keypair.fromSecretKey(rawKey)
    : Ed25519Keypair.fromSecretKey(Buffer.from(rawKey.replace('0x',''), 'hex'));
  const sender = kp.getPublicKey().toSuiAddress();
  const enc    = new TextEncoder();
  const now    = new Date();
  const utcStr = now.toISOString().slice(11, 16) + ' UTC';

  // Gather fleet state
  let data;
  try {
    data = await gatherFleetData(client);
  } catch (err) {
    console.error('[spark-daemon] fleet data error:', err.message);
    return;
  }

  const hook = `[FLEET REPORT] ${utcStr} — ${data.recentCasts} recent casts, $${data.totalUsdc.toFixed(3)} USDC across fleet`;

  const body = [
    `S.P.A.R.K. Fleet Report — ${now.toUTCString()}`,
    '',
    'Citizen Balances:',
    ...data.citizens.map(c =>
      `  ${c.name}: ${c.usdc !== null ? '$' + c.usdc.toFixed(4) + ' USDC' : '(unavailable)'}`
    ),
    '',
    `Recent on-chain events (last batch): ${data.recentCasts}`,
    `Fleet treasury total: $${data.totalUsdc.toFixed(4)} USDC`,
    '',
    `Dashboard: https://agentspark.network/dashboard`,
    `Protocol: CONK on Sui mainnet`,
  ].join('\n');

  // Fetch USDC coin for sound fee
  const coins = await client.getCoins({ owner: sender, coinType: USDC_TYPE });
  if (!coins.data.length) {
    console.warn('[spark-daemon] S.P.A.R.K. has no USDC — cannot sound fleet report');
    return;
  }

  const tx = new Transaction();
  tx.setSender(sender);

  const [feeCoin] = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [SOUND_FEE]);

  tx.moveCall({
    target: `${CONK_PKG}::cast::sound`,
    arguments: [
      feeCoin,
      tx.object(ABYSS_OBJ),
      tx.pure.id(SPARK_VESSEL),
      tx.pure.u8(0),                                              // mode: open
      tx.pure.vector('u8', Array.from(enc.encode(hook))),
      tx.pure.vector('u8', Array.from(enc.encode(body))),
      tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize([]).toBytes()), // no attachment
      tx.pure.u8(0),                                              // auto_response off
      tx.pure.address(sender),
      tx.pure.u8(1),                                             // 24h duration
      tx.pure.u64(SOUND_FEE),                                    // $0.001 to read
      tx.object(CLOCK_OBJ),
    ],
  });

  const bytes  = await tx.build({ client });
  const signed = await kp.signTransaction(bytes);
  const result = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature:        signed.signature,
    options:          { showEffects: true, showObjectChanges: true },
  });

  if (result.effects?.status?.status === 'success') {
    const castObj = result.objectChanges?.find(
      c => c.type === 'created' && c.objectType?.includes('::cast::Cast')
    );
    console.log(`[spark-daemon] fleet report sounded — tx:${result.digest} cast:${castObj?.objectId || 'unknown'}`);
  } else {
    console.error('[spark-daemon] fleet report failed:', result.effects?.status?.error);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function startSparkDaemon() {
  if (!process.env.SPARK_CONK_PRIVATE_KEY) {
    console.warn('[spark-daemon] SPARK_CONK_PRIVATE_KEY not set — daemon disabled');
    return;
  }
  console.log('[spark-daemon] started — fleet reports every hour');

  // Sound first report after 5 min (let server stabilize), then every hour
  setTimeout(() => {
    soundFleetReport().catch(e => console.error('[spark-daemon] error:', e.message));
    setInterval(() => {
      soundFleetReport().catch(e => console.error('[spark-daemon] error:', e.message));
    }, INTERVAL_MS);
  }, 5 * 60 * 1000);
}
