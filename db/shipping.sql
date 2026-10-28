-- Delivery details are private to the trusted server, not the Data API.
-- Existing products stay unclassified until an administrator explicitly selects a type.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS shipping_type text CHECK(shipping_type IN ('physical','none'));
CREATE TABLE IF NOT EXISTS shop_order_shipping (
 order_id uuid PRIMARY KEY REFERENCES shop_orders(id),
 recipient text NOT NULL CHECK(length(recipient) BETWEEN 1 AND 100),
 phone text NOT NULL CHECK(length(phone) BETWEEN 1 AND 40),
 address text NOT NULL CHECK(length(address) BETWEEN 1 AND 500),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 status text NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','shipped','delivered')),
 carrier text NOT NULL DEFAULT '' CHECK(length(carrier)<=100),
 tracking_number text NOT NULL DEFAULT '' CHECK(length(tracking_number)<=100),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shop_order_shipping ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shop_order_shipping FROM PUBLIC,anon,authenticated;
