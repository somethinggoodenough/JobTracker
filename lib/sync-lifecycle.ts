// A separate request can close an orphaned run when its owning Worker
// invocation disappeared and can no longer execute timers or cleanup.
export const SYNC_HEARTBEAT_SOURCE = -2;
export const SYNC_HEARTBEAT_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 45_000;
const LOST_OWNER = "同步进程心跳中断，剩余候选已保留";

export async function recoverStaleSync(db: D1Database, runId?: number, now = new Date()): Promise<boolean> {
  const stamp = now.toISOString();
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const stale = await db.prepare(`SELECT r.id FROM scrape_runs r
    JOIN scrape_source_progress p ON p.run_id=r.id AND p.source_id=?1
    WHERE r.status IN ('running','cancelling') AND p.updated_at<=?2 AND (?3 IS NULL OR r.id=?3)
    ORDER BY r.id DESC LIMIT 1`).bind(SYNC_HEARTBEAT_SOURCE, cutoff, runId ?? null).first<{ id: number }>();
  if (!stale) return false;

  const [result] = await db.batch([
    db.prepare(`UPDATE scrape_runs SET
      status=CASE WHEN status='cancelling' THEN 'cancelled'
        WHEN EXISTS (SELECT 1 FROM scrape_source_progress WHERE run_id=?1 AND source_id<>?2 AND stage IN ('success','partial'))
        THEN 'partial' ELSE 'failed' END,
      finished_at=?3, error_summary=?4,
      sources_succeeded=(SELECT COUNT(*) FROM scrape_source_progress WHERE run_id=?1 AND source_id<>?2 AND stage IN ('success','partial'))
      WHERE id=?1 AND status IN ('running','cancelling') AND EXISTS (
        SELECT 1 FROM scrape_source_progress WHERE run_id=?1 AND source_id=?2 AND updated_at<=?5
      )`).bind(stale.id, SYNC_HEARTBEAT_SOURCE, stamp, LOST_OWNER, cutoff),
    db.prepare(`UPDATE scrape_source_progress SET
      stage=CASE WHEN (SELECT status FROM scrape_runs WHERE id=?1)='cancelled' THEN 'cancelled' ELSE 'failed' END,
      finished_at=?2, updated_at=?2, error=COALESCE(error,?3)
      WHERE run_id=?1 AND stage IN ('queued','fetching','saving','classifying')
      AND EXISTS (SELECT 1 FROM scrape_runs WHERE id=?1 AND finished_at=?2 AND error_summary=?3)`)
      .bind(stale.id, stamp, LOST_OWNER),
    db.prepare(`UPDATE job_candidates SET claim_run_id=NULL WHERE claim_run_id=?1 AND EXISTS (
      SELECT 1 FROM scrape_runs WHERE id=?1 AND finished_at=?2 AND error_summary=?3
    )`).bind(stale.id, stamp, LOST_OWNER),
  ]);
  return !!result.meta.changes;
}
