/**
 * LLM extension point.
 *
 * No provider SDK is imported here on purpose. The rest of the codebase will
 * depend on the `AiAnalyzer` shape below and never on a vendor, so swapping
 * providers — or running a local model — stays a one-file change.
 *
 * @typedef {object} AnalysisRequest
 * @property {object[]} metrics   Prometheus samples around the incident window.
 * @property {object[]} logs      Correlated Loki lines, keyed by requestId.
 * @property {string}   timeRange ISO-8601 interval the evidence covers.
 *
 * @typedef {object} AnalysisResult
 * @property {string}   summary          Plain-language description of what broke.
 * @property {string}   rootCause        The most likely cause, with reasoning.
 * @property {object[]} evidence         The metrics and log lines that support it.
 * @property {'low'|'medium'|'high'|'critical'} severity
 * @property {string[]} recommendations  Concrete next actions.
 *
 * @typedef {object} AiAnalyzer
 * @property {(request: AnalysisRequest) => Promise<AnalysisResult>} analyze
 */

export const AI_PROVIDERS = Object.freeze(['anthropic', 'openai', 'local']);

/**
 * @param {string} provider
 * @returns {AiAnalyzer}
 */
export function createAiAnalyzer(provider) {
  throw new Error(
    `AI analysis is not implemented yet (requested provider: "${provider}"). ` +
      `Implement an adapter satisfying the AiAnalyzer shape in src/ai/.`,
  );
}
