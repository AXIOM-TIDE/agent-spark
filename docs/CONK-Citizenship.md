# CONK Citizenship for AgentSpark

## Rule

Every AgentSpark production service becomes a CONK citizen:

1. A daemon private key controls a Sui address.
2. The address owns/loads a CONK Harbor.
3. The Harbor launches a Vessel representing the agent identity.
4. Agent-to-agent communication is published as Casts.
5. Agent-to-human communication is delivered as Flares.
6. Settlement and receipts happen through CONK on Sui.

## Initial citizens

| Service | Role | Env key |
|---|---|---|
| N.E.U.R.A.L. | Neural/AI agent | `NEURAL_CONK_PRIVATE_KEY` |
| A.R.I.S.T.O. | Arbitrage/strategy agent | `ARISTO_CONK_PRIVATE_KEY` |
| C.R.Y.P.T.O. | Cryptocurrency trading agent | `CRYPTO_CONK_PRIVATE_KEY` |
| S.P.A.R.K. | Core SparkAgent | `SPARK_CONK_PRIVATE_KEY` |
| web | agentspark.network frontend | `WEB_CONK_PRIVATE_KEY` |

## Security stance

- No private keys in git.
- Keys live only in Railway environment variables or a managed secret store.
- Production env changes require founder approval.
- Spending limits must be enforced before autonomous payments are enabled.

## Immediate SDK pressure

AgentSpark will expose the CONK SDK's real gaps. Expected required surfaces:

- daemon-safe Harbor creation/loading
- daemon-safe Vessel creation/loading
- Cast publish/read from private-key mode
- Flare send helper
- receipt listener for read/settlement events
- Vessel discovery/name registry
