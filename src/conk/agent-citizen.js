import { ConkClient } from '@axiomtide/conk-sdk'

export function createAgentConkClient(agent, env = process.env) {
  const privateKey = env[agent.privateKeyEnv]
  if (!privateKey) {
    throw new Error(`${agent.displayName} missing ${agent.privateKeyEnv}`)
  }

  return new ConkClient({
    network: env.CONK_NETWORK || 'mainnet',
    proxy: env.CONK_PROXY_URL,
    privateKey,
  })
}

export async function describeConkCitizen(agent, env = process.env) {
  const conk = createAgentConkClient(agent, env)
  return {
    agentId: agent.id,
    displayName: agent.displayName,
    service: agent.service,
    role: agent.role,
    address: conk.currentAddress(),
    network: env.CONK_NETWORK || 'mainnet',
  }
}
