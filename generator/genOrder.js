"use strict";

require("dotenv").config();

const AWS = require("aws-sdk");
const mydb = require("./lib/mydb");
const fs = require("fs");

const WSS_endpoint = process.env.WSS_ENDPOINT;

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

const sqlOrderDashboard = `
SELECT
  o.*,
  to_jsonb(s) as "store"
FROM "gn_order" o
LEFT JOIN store s ON s.store_id = o.store_id
ORDER BY "order_date" DESC
LIMIT 100
`;

const sqlWssConnIds = `
SELECT "conn_id" FROM "wss"
`;

const wssSendOrderDashboard = async (opts) => {
  const { client } = opts;
  const logPrefix = `${opts.logPrefix || ""} wssSendOrderDashboard`.trim();

  const conn_ids = (await client.query(sqlWssConnIds)).rows.map(
    (e) => e.conn_id
  );
  if (!conn_ids || !conn_ids.length) {
    console.error("No connections to postAll");
    return;
  }

  const { rows } = await client.query(sqlOrderDashboard);
  fs.writeFileSync("./1", JSON.stringify(rows));
  const orders = rows.map((row) => ({
    order_id: row.gn_order_id,
    channel_order_id: row.channel_order_id,
    order_date: row.order_date.toISOString(),
    postalCode: row.ship_address.postalCode,
    seller: {
      id: row.store && row.store.store_id ? row.store.store_id : null,
      url: row.store && row.store.data ? row.store.data.sellerPage : null,
      name: row.store && row.store.name ? row.store.name : null,
    },
    items: row.items.map((item) => ({
      product_id: item.product_id,
      qty: item.qty,
      price:
        item.productObj && item.productObj.price
          ? +item.productObj.price
          : null,
      img:
        item.productObj && item.productObj.data && item.productObj.data.imgSrc
          ? item.productObj.data.imgSrc
          : null,
      title:
        item.productObj && item.productObj.title ? item.productObj.title : null,
    })),
  }));
  if (!rows || !rows.length) {
    console.error("No rows to postAll");
    return;
  }

  const { apigwManagementApi } = opts;

  for (const connectionId of conn_ids) {
    console.log("%s post rows to %s", logPrefix, connectionId);
    await apigwManagementApi
      .postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify(orders),
      })
      .promise();
  }
};

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
const generateOneOrder = async (opts, genQtyParam) => {
  const logPrefix = `${opts.logPrefix || ""} generateOneOrder`.trim();
  const client = opts.client;
  if (!client) {
    throw Error("opts.client required!");
  }

  const { rows: dbProducts } = await client.query(sqlProductRnd);
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
    "1111",
    null, //new Date(),
    orderObj.store_id,
    JSON.stringify(items),
    JSON.stringify({ countryCode: "XX" }), // ship_address
    JSON.stringify({ countryCode: "XX", code: "ZZZ" }), // whObj
    "{}",
  ]);
  console.log("%s OrderInserted: ", logPrefix, rowsOrderInsert);

  await wssSendOrderDashboard({ ...opts, client, logPrefix });
};

const main = async (opts) => {
  const logPrefix = `${opts.logPrefix || ""} main`.trim();
  opts.apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: "2018-11-29",
    endpoint: WSS_endpoint,
  });
  await mydb.updatePgConnection({ ...opts, logPrefix });
  await generateOneOrder({ ...opts, client: mydb }, defOrderRandom);
};
main({});
