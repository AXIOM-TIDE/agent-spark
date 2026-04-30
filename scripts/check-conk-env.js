import 'dotenv/config'
import { AGENTS } from '../src/config/agents.js'
import { describeConkCitizen } from '../src/conk/agent-citizen.js'

let failed = false

for (const agent of AGENTS) {
  try {
    const citizen = await describeConkCitizen(agent)
    console.log(`${citizen.displayName}: ${citizen.address}`)
  } catch (err) {
    failed = true
    console.error(`${agent.displayName}: ${err.message}`)
  }
}

if (failed) process.exit(1)
