import { AGENTS } from '../config/agents.js'
import { describeConkCitizen } from './agent-citizen.js'

const registry = new Map()

export function getAgentConfig(agentId) {
  const normalized = String(agentId || '').toLowerCase()
  const agent = AGENTS.find(a => a.id === normalized || a.service.toLowerCase() === normalized || a.displayName.toLowerCase() === normalized)
  if (!agent) throw new Error(`Unknown AgentSpark CONK citizen: ${agentId}`)
  return agent
}

export async function initConkCitizen(agentId, options = {}) {
  const agent = getAgentConfig(agentId)
  const logger = options.logger || console

  try {
    const citizen = await describeConkCitizen(agent, options.env || process.env)
    registry.set(agent.id, {
      ...citizen,
      configured: true,
      initializedAt: new Date().toISOString(),
    })
    logger.log?.(`[CONK] ${agent.displayName} citizen address: ${citizen.address}`)
    return registry.get(agent.id)
  } catch (err) {
    const disabled = {
      agentId: agent.id,
      displayName: agent.displayName,
      service: agent.service,
      role: agent.role,
      configured: false,
      reason: err.message,
      initializedAt: new Date().toISOString(),
    }
    registry.set(agent.id, disabled)
    logger.warn?.(`[CONK] ${agent.displayName} citizenship not configured: ${err.message}`)
    return disabled
  }
}

export async function initAllConkCitizens(options = {}) {
  return Promise.all(AGENTS.map(agent => initConkCitizen(agent.id, options)))
}

export function listConkCitizens() {
  return AGENTS.map(agent => registry.get(agent.id) || {
    agentId: agent.id,
    displayName: agent.displayName,
    service: agent.service,
    role: agent.role,
    configured: false,
    reason: 'not initialized',
  })
}
