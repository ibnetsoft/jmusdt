import { database } from "./db";
import { HttpError } from "./http";
export async function organizationTree(
  viewer: string,
  mode: "referral" | "sponsor",
  root: string,
  depth: number,
) {
  const db = database();
  const allowed = await db.query(
    "SELECT network_contains($1,$2,$3) AS allowed",
    [viewer, root, mode],
  );
  if (!allowed.rows[0].allowed)
    throw new HttpError(403, "본인 산하 조직만 조회할 수 있습니다.");
  const field = mode === "referral" ? "referrer_id" : "sponsor_id";
  const columns = `n.user_id AS id,p.name,n.referral_code AS code,p.created_at,n.position,p.status,
 EXISTS(SELECT 1 FROM member_network c WHERE c.sponsor_id=n.user_id AND c.position='L') AS left_occupied,
 EXISTS(SELECT 1 FROM member_network c WHERE c.sponsor_id=n.user_id AND c.position='R') AS right_occupied,
 EXISTS(SELECT 1 FROM member_network c WHERE c.${field}=n.user_id AND c.activated_at IS NOT NULL) AS has_children,
 coalesce((SELECT sum(o.total) FROM shop_orders o WHERE o.user_id=n.user_id AND o.status<>'cancelled'),0)::text AS sales`;
  const start = await db.query(
    `SELECT ${columns} FROM member_network n JOIN profiles p ON p.id=n.user_id WHERE n.user_id=$1`,
    [root],
  );
  const nodes = [{ ...start.rows[0], parent_id: null, depth: 0 }];
  let frontier = [root],
    truncated = false;
  for (let level = 1; level <= (depth || 50) && frontier.length; level++) {
    const remaining = 500 - nodes.length;
    const next = await db.query(
      `SELECT ${columns},n.${field} AS parent_id FROM member_network n JOIN profiles p ON p.id=n.user_id WHERE n.${field}=ANY($1::uuid[]) AND n.activated_at IS NOT NULL ORDER BY p.created_at,n.user_id LIMIT $2`,
      [frontier, remaining + 1],
    );
    if (next.rows.length > remaining) truncated = true;
    const seen = new Set(nodes.map((n) => n.id));
    const rows = next.rows.slice(0, remaining).filter((n) => !seen.has(n.id));
    nodes.push(...rows.map((n) => ({ ...n, depth: level })));
    frontier = rows.map((n) => n.id);
    if (truncated) break;
    if (level === 50 && frontier.length) truncated = true;
  }
  const own = await db.query(
    "SELECT referral_code FROM member_network WHERE user_id=$1",
    [viewer],
  );
  const pending = await db.query(
    "SELECT n.user_id AS id,p.name,n.referral_code AS code FROM member_network n JOIN profiles p ON p.id=n.user_id WHERE n.referrer_id=$1 AND n.sponsor_id IS NULL AND n.activated_at IS NOT NULL AND p.status='active' ORDER BY p.created_at,n.user_id LIMIT 501",
    [viewer],
  );
  return {
    viewer,
    nodes,
    pending: pending.rows.slice(0, 500),
    pendingTruncated: pending.rows.length > 500,
    code: own.rows[0].referral_code,
    truncated,
  };
}
