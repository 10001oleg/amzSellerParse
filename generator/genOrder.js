"use strict";

const sqlProductRnd = `
SELECT
  "product_id",
  "star"
  -- ,SUM(star) OVER(rows between unbounded preceding and current row) as star_paging
FROM "product"
WHERE true
  AND "star" > 0
  AND "price" > 0
  AND NOT "is_deleted"
  AND CASE 
    WHEN $1::integer IS NULL THEN true
    ELSE "store_id" = $1::integer
  END
`;
const sqlGnOrderInsert = `
INSERT INTO gn_order(
  "channel_order_id",
  "order_date",
  "store_id",
  "items",
  "ship_address",
  "wh",
  "data"
)
VALUES (
  $1,
  COALESCE(
    $2,
    GREATEST(
      (SELECT MAX(order_date) FROM "gn_order"),
      CURRENT_TIMESTAMP
    ) + INTERVAL '10 SECOND'
  ),
  $3,$4,$5,$6,$7
)
RETURNING "gn_order_id"
`;

const randomWeighted = (arr) => {
  //console.log("randomWeighted run with param ", arr);
  // arr = [{w: 1, v: "a"},{w: 25, v: "b"}]
  const totalWeight = arr.reduce((acc, cur) => acc + (+cur.w || 0), 0);
  const threshold = Math.random() * totalWeight;
  //console.log("xx ", totalWeight, threshold);
  let curTotal = 0;
  for (const cur of arr) {
    curTotal += +cur.w || 0;
    if (curTotal >= threshold) return cur.v;
  }
};

const defOrderRandom = {
  itemCountAlloc: [
    { w: 95, v: 1 },
    { w: 3, v: 2 },
    { w: 2, v: 3 },
    { w: 0.1, v: 4 },
  ],
  itemQtyProb: [
    { w: 95, v: 1 },
    { w: 3, v: 2 },
    { w: 2, v: 3 },
    { w: 0.1, v: 4 },
  ],
};

const generateOneOrder = async (
  opts,
  genQtyParam = defOrderRandom,
  filter = {}
) => {
  const logPrefix = `${opts.logPrefix || ""} generateOneOrder`.trim();
  const client = opts.client;
  if (!client) {
    throw Error("opts.client required!");
  }

  const { rows: dbProducts } = await client.query(sqlProductRnd, [
    filter && filter.store_id ? filter.store_id : null,
  ]);
  const starValueSum = dbProducts.reduce(
    (acc, e) => (acc || 0) + (+e.star || 0),
    0
  );
  console.log(
    "%s Calculate %s products star sum: %s",
    logPrefix,
    dbProducts.length,
    starValueSum
  );
  const items = [];
  const itemCount = randomWeighted(genQtyParam.itemCountAlloc);
  for (let i = 1; i <= itemCount; i++) {
    const product_id = randomWeighted(
      dbProducts.map(({ product_id, star }) => ({
        w: +star,
        v: product_id,
      }))
    );
    const qty = randomWeighted(genQtyParam.itemQtyProb);
    items.push({ product_id, qty });
  }
  console.log("%s generate items:", logPrefix, items);
  const product_ids = items.map((e) => +e.product_id);
  const {
    rows: productsObj,
  } = await client.query(
    `SELECT * FROM "product" WHERE "product_id" = ANY($1::integer[])`,
    [product_ids]
  );
  items.map((item) => {
    item.productObj = productsObj.filter(
      (e) => e.product_id == item.product_id
    )[0];
  });
  const orderObj = {
    store_id: items.reduce((store_id, item) => {
      if (store_id) return store_id;
      if (item && item.productObj && item.productObj.store_id)
        return item.productObj.store_id;
      return undefined;
    }, undefined),
  };
  const { rows: rowsOrderInsert } = await client.query(sqlGnOrderInsert, [
    "222-xx",
    filter && filter.orderDate ? new Date(filter.orderDate) : null, //new Date(),
    orderObj.store_id,
    JSON.stringify(items),
    JSON.stringify({ countryCode: "XX" }), // ship_address
    JSON.stringify({ countryCode: "XX", code: "ZZZ" }), // whObj
    "{}",
  ]);
  console.log("%s OrderInserted: ", logPrefix, rowsOrderInsert);
  return rowsOrderInsert[0];
};

module.exports = { generateOneOrder };
