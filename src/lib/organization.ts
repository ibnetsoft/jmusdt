import { database } from "./db";
import { HttpError } from "./http";
export async function organizationTree(
  viewer: string,
  mode: "referral" | "sponsor",
  root: string,
  depth: number,
) {
  const db = database();
  const own = await db.query("SELECT referral_code,member_reward_eligible(user_id) AS eligible FROM member_network WHERE user_id=$1", [viewer]);
  if (!own.rows[0]?.eligible) return {viewer,code:own.rows[0]?.referral_code || "",eligible:false,nodes:[],pending:[],pendingTruncated:false,truncated:false};
  const field = mode === "referral" ? "referrer_id" : "sponsor_id";
  const columns = `n.user_id AS id,p.name,n.referral_code AS code,p.created_at,n.referral_ordinal::text,n.rollup_generation,p.status,
 EXISTS(SELECT 1 FROM member_network c WHERE c.${field}=n.user_id AND c.activated_at IS NOT NULL) AS has_children,
 coalesce((SELECT sum(o.total) FROM shop_orders o WHERE o.user_id=n.user_id AND o.currency='POINT' AND o.status IN ('paid','cancellation_requested')),0)::text AS sales`;
  const [allowed, start, pending] = await Promise.all([db.query(
    "SELECT network_contains($1,$2,$3) AS allowed",
    [viewer, root, mode],
  ), db.query(
    `SELECT ${columns} FROM member_network n JOIN profiles p ON p.id=n.user_id WHERE n.user_id=$1 AND n.activated_at IS NOT NULL`,
    [root],
  ), db.query(
    "SELECT n.user_id AS id,p.name,n.referral_code AS code,n.placement_reason FROM member_network n JOIN profiles p ON p.id=n.user_id WHERE n.referrer_id=$1 AND n.sponsor_id IS NULL AND n.activated_at IS NOT NULL AND p.status='active' ORDER BY n.registration_index LIMIT 501",
    [viewer],
  )]);
  if (!allowed.rows[0].allowed)
    throw new HttpError(403, "본인 산하 조직만 조회할 수 있습니다.");
  if (!start.rows.length) throw new HttpError(404,"정회원 조직을 찾을 수 없습니다.");
  const nodes = [{ ...start.rows[0], parent_id: null, depth: 0 }];
  let frontier = [root],
    truncated = false;
  for (let level = 1; level <= (depth || 50) && frontier.length; level++) {
    const remaining = 500 - nodes.length;
    const next = await db.query(
      `SELECT ${columns},n.${field} AS parent_id FROM member_network n JOIN profiles p ON p.id=n.user_id WHERE n.${field}=ANY($1::uuid[]) AND n.activated_at IS NOT NULL ORDER BY n.registration_index,n.user_id LIMIT $2`,
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
  return {
    viewer,
    eligible:true,
    nodes,
    pending: pending.rows.slice(0, 500),
    pendingTruncated: pending.rows.length > 500,
    code: own.rows[0].referral_code,
    truncated,
  };
}
