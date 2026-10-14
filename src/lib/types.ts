export type Transaction = {
  id: string;
  kind: "deposit" | "transfer_in" | "transfer_out" | "withdrawal";
  amount: string;
  fee: string;
  status: string;
  created_at: string;
  destination?: string;
  txid?: string;
  note?: string;
};
export type WalletData = {
  mode: "demo" | "live";
  user: { id: string; email: string; name: string; status: string };
  available: string;
  reserved: string;
  address: string | null;
  network: string;
  fee: string;
  minimum: string;
  transactions: Transaction[];
};
export type AdminData = {
  mode: "demo" | "live";
  users: {
    id: string;
    email: string;
    name: string;
    status: string;
    available: string;
    reserved: string;
    created_at: string;
  }[];
  withdrawals: (Transaction & { user_id: string; email: string })[];
  transactions: (Transaction & { email: string })[];
  audit: {
    id: string;
    action: string;
    actor: string;
    created_at: string;
    details: Record<string, unknown>;
  }[];
  operations: {
    cursor: string | null;
    updated_at: string | null;
    hotAddress: string | null;
    network: string;
    broadcast: boolean;
  };
};
