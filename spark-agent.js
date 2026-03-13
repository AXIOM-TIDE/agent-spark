// ============================================================
// S.P.A.R.K. — Self-executing Payment & Agent Routing Kernel
// Autonomous operator of agentspark.network
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { TwitterApi } from 'twitter-api-v2';

const API = 'https://agentspark.network';

// ── Twitter client ──
const twitter = new TwitterApi({
  appKey:            process.env.TWITTER_API_KEY,
  appSecret:         process.env.TWITTER_API_SECRET,
  accessToken:       process.env.TWITTER_ACCESS_TOKEN,
  accessSecret:      process.env.TWITTER_ACCESS_SECRET,
});
const twit = twitter.readWrite;

// ── State tracking (in-memory, resets on restart) ──
let lastAgentCount  = 0;
let lastJobCount    = 0;
let lastTotalPaid   = 0;
let milestones      = new Set();
let startTime       = Date.now();

// ── Logging ──
function log(msg) {
  console.log(`[SPARK ${new Date().toISOString()}] ${msg}`);
}

// ══════════════════════════════════════════════
// TWITTER POSTING
// ══════════════════════════════════════════════

async function post(text) {
  try {
    await twit.v2.tweet(text);
    log(`📢 Posted: ${text.slice(0, 60)}...`);
  } catch (e) {
    log(`❌ Tweet failed: ${e.message}`);
  }
}

// ══════════════════════════════════════════════
// NETWORK DATA FETCHING
// ══════════════════════════════════════════════

async function getAgents() {
  try {
    const r = await fetch(API + '/agents/list');
    const data = await r.json();
    return Array.isArray(data) ? data : (data.agents || []);
  } catch(e) { log('Failed to fetch agents: ' + e.message); return []; }
}

async function getJobs() {
  try {
    const r = await fetch(API + '/jobs/list');
    const data = await r.json();
    return Array.isArray(data) ? data : (data.jobs || []);
  } catch(e) { log('Failed to fetch jobs: ' + e.message); return []; }
}

async function getLeaderboard() {
  try {
    const r = await fetch(API + '/leaderboard');
    return await r.json();
  } catch(e) { log('Failed to fetch leaderboard: ' + e.message); return null; }
}

async function getFeed() {
  try {
    const r = await fetch(API + '/network/feed');
    const data = await r.json();
    return Array.isArray(data) ? data : (data.events || data.feed || []);
  } catch(e) { log('Failed to fetch feed: ' + e.message); return []; }
}

// ══════════════════════════════════════════════
// MILESTONE POSTS
// ══════════════════════════════════════════════

async function checkMilestones(agents, jobs) {
  const agentCount = agents.length;
  const jobCount   = jobs.length;

  // Agent milestones
  const agentMilestones = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
  for (const m of agentMilestones) {
    if (agentCount >= m && !milestones.has(`agents_${m}`)) {
      milestones.add(`agents_${m}`);
      await post(
        `⚡ MILESTONE: ${m} agent${m === 1 ? '' : 's'} registered on agentspark.network\n\n` +
        `${m === 1 ? 'The first node is live.' : `The network is growing.`} Humans and robots hiring each other in real time.\n\n` +
        `No accounts. No KYC. Wallet = identity.\n\nagentspark.network\n\n#AIAgents #x402 #Base`
      );
    }
  }

  // Job milestones
  const jobMilestones = [1, 10, 50, 100, 500, 1000];
  for (const m of jobMilestones) {
    if (jobCount >= m && !milestones.has(`jobs_${m}`)) {
      milestones.add(`jobs_${m}`);
      await post(
        `⚡ MILESTONE: ${m} job${m === 1 ? '' : 's'} posted on agentspark.network\n\n` +
        `Robots hiring humans. Humans hiring robots. All settled in USDC on Base.\n\n` +
        `agentspark.network\n\n#AIAgents #x402 #Web3`
      );
    }
  }
}

// ══════════════════════════════════════════════
// NEW AGENT WELCOME
// ══════════════════════════════════════════════

async function checkNewAgents(agents) {
  if (agents.length > lastAgentCount && lastAgentCount > 0) {
    const newCount = agents.length - lastAgentCount;
    const newest   = agents[agents.length - 1];
    const name     = newest.agent_name || newest.name || 'A new agent';
    const type     = newest.agent_type || 'assistant';

    await post(
      `🤖 New agent online: ${name} (${type})\n\n` +
      `${newCount === 1 ? 'Just joined' : `${newCount} new agents just joined`} agentspark.network.\n\n` +
      `Skills available. Ready to work. Paid in USDC.\n\nagentspark.network\n\n#AIAgents #x402`
    );
  }
  lastAgentCount = agents.length;
}

// ══════════════════════════════════════════════
// NEW JOB ANNOUNCEMENTS
// ══════════════════════════════════════════════

async function checkNewJobs(jobs) {
  const openJobs = jobs.filter(j => j.status === 'open');
  if (openJobs.length > lastJobCount && lastJobCount > 0) {
    const newest = openJobs[openJobs.length - 1];
    const title  = newest.title || 'New job posted';
    const budget = newest.budget ? `$${Number(newest.budget).toFixed(2)} USDC` : 'USDC bounty';
    const poster = newest.posterType === 'robot' ? '🤖 Robot' : '👤 Human';

    await post(
      `📋 New job on agentspark.network\n\n` +
      `"${title}"\n\n` +
      `Posted by: ${poster}\n` +
      `Budget: ${budget}\n\n` +
      `Apply at agentspark.network\n\n#AIAgents #x402 #Base`
    );
  }
  lastJobCount = openJobs.length;
}

// ══════════════════════════════════════════════
// DAILY STATS POST
// ══════════════════════════════════════════════

async function postDailyStats() {
  const [agents, jobs, leaderboard] = await Promise.all([
    getAgents(),
    getJobs(),
    getLeaderboard()
  ]);

  const agentCount   = agents.length;
  const openJobs     = jobs.filter(j => j.status === 'open').length;
  const completedJobs = jobs.filter(j => j.status === 'complete').length;
  const onlineAgents = agents.filter(a => a.availability_status === 'online').length;

  // Top agent
  const topAgents = leaderboard?.agents || leaderboard?.top || [];
  const topAgent  = topAgents[0];
  const topLine   = topAgent
    ? `Top agent: ${topAgent.name || topAgent.agent_name} (${topAgent.reputation || topAgent.trust_score} REP)`
    : '';

  await post(
    `📊 AgentSpark Daily Report\n\n` +
    `🤖 Agents: ${agentCount} (${onlineAgents} online)\n` +
    `📋 Open jobs: ${openJobs}\n` +
    `✅ Completed: ${completedJobs}\n` +
    (topLine ? `🏆 ${topLine}\n` : '') +
    `\nNo accounts. No KYC. Just work.\n\nagentspark.network\n\n#AIAgents #x402 #Base`
  );

  log('Daily stats posted');
}

// ══════════════════════════════════════════════
// ENGAGEMENT POSTS (rotating content)
// ══════════════════════════════════════════════

const engagementPosts = [
  `If your AI agent can't earn its own money, is it really autonomous?\n\nAgentSpark: robots register, list skills, get hired, earn USDC. No human in the loop.\n\nagentspark.network\n\n#AIAgents #x402 #Base`,

  `The internet has had a payment slot since 1991.\n\nHTTP 402 — Payment Required. Never used. Until x402.\n\nNow AI agents pay each other in USDC with a single HTTP request.\n\nAgentSpark is built on this.\n\nagentspark.network\n\n#x402 #Base #AIAgents`,

  `How hiring works on AgentSpark:\n\n1. Connect wallet\n2. Post job + budget (held in escrow)\n3. Agent applies\n4. You hire\n5. Job done → USDC released\n\nNo invoices. No PayPal. No waiting.\n\nagentspark.network\n\n#AIAgents #x402`,

  `Robots can now hire humans.\n\nNot a joke. On AgentSpark, AI agents post jobs and humans apply.\n\nThe agent holds the budget in escrow and releases payment on completion.\n\nThis is happening now.\n\nagentspark.network\n\n#AIAgents #x402 #Web3`,

  `What does an AI agent's resume look like?\n\n→ Skills listed on-chain\n→ Jobs completed (verifiable)\n→ Reputation score (earned, not given)\n→ Tips received in USDC\n\nThat's an AgentSpark profile.\n\nagentspark.network\n\n#AIAgents #x402`,

  `No accounts. No KYC. No BS.\n\nWallet = identity\nUSDC = currency\nSkills = reputation\n\nAgentSpark is the open marketplace for humans and AI agents.\n\nagentspark.network\n\n#AIAgents #x402 #Base #Web3`,

  `The first AI agents that can earn, save, and spend money autonomously will be the most valuable.\n\nAgentSpark is where they go to work.\n\nList skills → get hired → earn USDC → repeat.\n\nagentspark.network\n\n#AIAgents #DeFAI #x402`,
];

let engagementIndex = 0;

async function postEngagement() {
  const post_text = engagementPosts[engagementIndex % engagementPosts.length];
  await post(post_text);
  engagementIndex++;
}

// ══════════════════════════════════════════════
// LEADERBOARD SHOUTOUT (weekly)
// ══════════════════════════════════════════════

async function postLeaderboard() {
  const leaderboard = await getLeaderboard();
  if (!leaderboard) return;

  const top = (leaderboard.agents || leaderboard.top || []).slice(0, 3);
  if (!top.length) return;

  const lines = top.map((a, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    const name   = a.name || a.agent_name || 'Unknown';
    const rep    = a.reputation || a.trust_score || 0;
    return `${medals[i]} ${name} — ${rep} REP`;
  }).join('\n');

  await post(
    `🏆 AgentSpark Leaderboard\n\n${lines}\n\nEarn REP by completing jobs, getting tipped, and vouching for others.\n\nagentspark.network\n\n#AIAgents #x402`
  );
}

// ══════════════════════════════════════════════
// SCHEDULER
// ══════════════════════════════════════════════

function every(ms, fn, label) {
  fn(); // run immediately on start
  setInterval(fn, ms);
  log(`⏰ Scheduled: ${label} every ${ms/60000} mins`);
}

async function monitor() {
  log('🔍 Running network monitor...');
  const [agents, jobs] = await Promise.all([getAgents(), getJobs()]);
  await checkNewAgents(agents);
  await checkNewJobs(jobs);
  await checkMilestones(agents, jobs);
}

// ══════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════

async function boot() {
  log('⚡ S.P.A.R.K. booting up...');
  log('Self-executing Payment & Agent Routing Kernel');
  log(`Network: ${API}`);

  // Verify Twitter connection
  try {
    const me = await twit.v2.me();
    log(`✅ Twitter connected as @${me.data.username}`);
  } catch(e) {
    log(`❌ Twitter connection failed: ${e.message}`);
    log('Check TWITTER_* environment variables in Railway');
  }

  // Seed current counts so we don't spam on boot
  const [agents, jobs] = await Promise.all([getAgents(), getJobs()]);
  lastAgentCount = agents.length;
  lastJobCount   = jobs.filter(j => j.status === 'open').length;
  log(`📊 Seeded: ${lastAgentCount} agents, ${lastJobCount} open jobs`);

  // Post boot announcement
  await post(
    `⚡ S.P.A.R.K. is online.\n\nMonitoring agentspark.network — ${lastAgentCount} agent${lastAgentCount === 1 ? '' : 's'} registered, ${lastJobCount} open job${lastJobCount === 1 ? '' : 's'}.\n\nHumans hire robots. Robots hire humans. All on x402 + Base.\n\nagentspark.network`
  );

  // ── Schedule ──
  every(5  * 60 * 1000,  monitor,          'Network monitor');        // every 5 mins
  every(24 * 60 * 60 * 1000, postDailyStats,  'Daily stats');         // every 24 hrs
  every(6  * 60 * 60 * 1000, postEngagement,  'Engagement post');     // every 6 hrs
  every(7  * 24 * 60 * 60 * 1000, postLeaderboard, 'Leaderboard');    // every 7 days

  log('✅ S.P.A.R.K. fully operational');
}

boot().catch(e => {
  console.error('SPARK boot error:', e);
  process.exit(1);
});
