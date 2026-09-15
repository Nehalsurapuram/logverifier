import { getLiveness, getReadiness } from '../services/health.service.js';

/** Controllers stay thin: shape the HTTP answer, leave the thinking to services. */
export function health(_req, res) {
  res.status(200).json(getLiveness());
}

export async function ready(_req, res) {
  const report = await getReadiness();
  res.status(report.status === 'ready' ? 200 : 503).json(report);
}
