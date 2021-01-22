"use strict";

require("dotenv").config();

const AWS = require("aws-sdk");

const WSS_endpoint = process.env.WSS_ENDPOINT;

const sqlOrderDashboard = `
SELECT
  o.*,
  to_jsonb(s) as "store"
FROM "gn_order" o
LEFT JOIN store s ON s.store_id = o.store_id
WHERE "order_date" <= CURRENT_TIMESTAMP
ORDER BY "order_date" DESC
LIMIT 100
`;

const sqlNextOrderDate = `
SELECT order_date, gn_order_id
FROM "gn_order" o
WHERE "order_date" > $1::timestamp with time zone
AND NOT gn_order_id = $2
ORDER BY "order_date" ASC
LIMIT 1
`;
const genDashboardFromOrders = (orders) =>
  orders.map((row) => ({
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

const postToAllConnections = async (opts, messageObj) => {
  const { client, apigwManagementApi } = opts;
  const logPrefix = `${opts.logPrefix || ""} postToAllConnections`.trim();
  const messageStr = JSON.stringify(messageObj);
  console.log("%s Try sending message %s chars", logPrefix, messageStr.length);
  //   const packed = require("jsonpack").pack(messageObj);
  //   console.log("%s Try sending packed message %s chars", logPrefix, packed.length);

  const sqlWssConnIds = `SELECT "conn_id" FROM "wss"`;

  const { rows } = await client.query(sqlWssConnIds);
  const conn_ids = rows.map((e) => e.conn_id);
  if (!conn_ids || !conn_ids.length) {
    console.error("No connections to postAll");
    return { status: "SUCCESS", message: "No connections to postAll" };
  }

  for (const connectionId of conn_ids) {
    console.log("%s post rows to %s", logPrefix, connectionId);
    await apigwManagementApi
      .postToConnection({
        ConnectionId: connectionId,
        Data: messageStr,
      })
      .promise();
  }
};
const serverWorker = async (opts = {}) => {
  const logPrefix = `${opts.logPrefix || ""} main`.trim();
  const { client } = opts;
  opts.apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: "2018-11-29",
    endpoint: WSS_endpoint,
  });
  const optsStack = { ...opts, logPrefix };

  let needDelay = 0;
  let lastOrderId = undefined;
  for (;;) {
    if (needDelay) {
      if (needDelay < 0) needDelay = 1e3;
      console.log("Delay %s sec ...", (needDelay / 1000).toFixed(1));
      await new Promise((res) => setTimeout(res, needDelay));
    }
    const { rows: orders } = await client.query(sqlOrderDashboard);
    const dashboard = genDashboardFromOrders(orders);

    // Can make asynchronous calls
    const maxOrderByDate = orders.reduce(
      (res, e) =>
        !res || (e.order_date && e.order_date > res.order_date) ? e : res,
      undefined
    );
    // console.log("maxOrderByDate", maxOrderByDate);
    if (!lastOrderId || lastOrderId != maxOrderByDate.gn_order_id) {
      await postToAllConnections(optsStack, dashboard);
      lastOrderId = maxOrderByDate.gn_order_id;
      console.log(
        "lastOrderId = %s, dashboard sire: %s",
        lastOrderId,
        dashboard.length
      );
    }

    // определяем необходимую задержку перед следующим вызовом
    console.log("try find order with date > %s", maxOrderByDate.order_date);
    const { rows: rowsNextOrder } = await client.query(sqlNextOrderDate, [
      maxOrderByDate.order_date,
      maxOrderByDate.gn_order_id,
    ]);
    if (rowsNextOrder.length === 0) {
      console.log("No order in the future");
      needDelay = 1e3;
      if (opts.cbCreateNewOrders) {
        await opts.cbCreateNewOrders(optsStack);
      } else {
        console.log("no function opts.'cbCreateNewOrders'");
      }
      continue;
    }
    const nextOrder = rowsNextOrder[0];
    console.log("nextOrder #%s last #%s", nextOrder.gn_order_id, lastOrderId);
    needDelay = nextOrder.order_date - Date.now();
    // delay loop
  }
};
module.exports = { serverWorker };
