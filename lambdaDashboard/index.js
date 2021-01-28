"use strict";

const AWS = require("aws-sdk");
const { Client } = require("pg");
const { tryCompress } = require("./lib/compress");

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

const packObjectNormalize = (p) =>
  !p.width || !p.height || !p.length || !p.weight
    ? p
    : {
        width: +p.width.toFixed(2),
        height: +p.height.toFixed(2),
        length: +p.length.toFixed(2),
        weight: +p.weight.toFixed(2),
      };

const genDashboardFromOrders = (orders) =>
  orders.map((row) => ({
    order_id: row.gn_order_id,
    channel_order_id: row.channel_order_id,
    order_date: row.order_date.toISOString(),
    seller: {
      id: row.store && row.store.store_id ? row.store.store_id : null,
      url: row.store && row.store.data ? row.store.data.sellerPage : null,
      name: row.store && row.store.name ? row.store.name : null,
    },
    wh: {
      code: row.wh && row.wh.code ? row.wh.code : null,
      PostalCode:
        row.wh && row.wh.ship_address && row.wh.ship_address.PostalCode
          ? row.wh.ship_address.PostalCode
          : null,
      StateOrRegion:
        row.wh && row.wh.ship_address && row.wh.ship_address.StateOrRegion
          ? row.wh.ship_address.StateOrRegion
          : null,
      City:
        row.wh && row.wh.ship_address && row.wh.ship_address.City
          ? row.wh.ship_address.City
          : null,
    },
    ship_address: {
      PostalCode:
        row.ship_address && row.ship_address.PostalCode
          ? row.ship_address.PostalCode
          : null,
      StateOrRegion:
        row.ship_address && row.ship_address.StateOrRegion
          ? row.ship_address.StateOrRegion
          : null,
      City:
        row.ship_address && row.ship_address.City
          ? row.ship_address.City
          : null,
    },
    items: row.items.map((item) => ({
      product_id: item.product_id,
      asin:
        item.productObj && item.productObj.asin ? item.productObj.asin : null,
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
      pack:
        item.productObj && item.productObj.data && item.productObj.data.pack
          ? packObjectNormalize(item.productObj.data.pack)
          : null,
      star:
        item.productObj &&
        item.productObj.data &&
        item.productObj.data.starValue
          ? +item.productObj.data.starValue
          : null,
      review:
        item.productObj &&
        item.productObj.data &&
        item.productObj.data.reviewValue
          ? +item.productObj.data.reviewValue
          : null,
      ranks:
        item.productObj && item.productObj.data && item.productObj.data.ranks
          ? item.productObj.data.ranks
          : null,
    })),
    carrier: {
      name: row.data && row.data.carrier_type ? row.data.carrier_type : null,
      rate: row.data && row.data.carrier_total ? row.data.carrier_total : null,
    },
  }));

const postToAllConnections = async (opts, endpoint, messageObj) => {
  const { client } = opts;
  const logPrefix = `${opts.logPrefix || ""} postToAllConnections`.trim();
  const messageStr = JSON.stringify(messageObj);
  //   const packed = require("jsonpack").pack(messageObj);
  //   console.log("%s Try sending packed message %s chars", logPrefix, packed.length);

  const apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: "2018-11-29",
    endpoint,
  });

  const sqlWssConnIds = `SELECT "conn_id" FROM "wss"`;

  const { rows } = await client.query(sqlWssConnIds);
  const conn_ids = rows.map((e) => e.conn_id);
  if (!conn_ids || !conn_ids.length) {
    console.error("No connections to postAll");
    return { status: "SUCCESS", message: "No connections to postAll" };
  }

  console.log(
    "%s Try sending message %s chars to %s connections",
    logPrefix,
    messageStr.length,
    conn_ids.length
  );

  const statuses = [];
  for (const connectionId of conn_ids) {
    console.log("%s post rows to %s", logPrefix, connectionId);
    try {
      await apigwManagementApi
        .postToConnection({
          ConnectionId: connectionId,
          Data: messageStr,
        })
        .promise();
      statuses.push(true);
    } catch (err) {
      console.error(
        "%s Failed WebSocket postToConnection %s\nError: %s\nStack: %s",
        logPrefix,
        connectionId,
        err.message,
        err.stack
      );
      statuses.push(false);
    }
  }
  if (statuses.some((e) => e)) {
    return {
      status: "SUCCESS",
      message: "Success posted messages",
      count: statuses.reduce((a, e) => a + (e ? 1 : 0), 0),
    };
  } else {
    return {
      status: "FAIL",
      message: "Failed posted messages",
      count: statuses.reduce((a, e) => a + (e ? 0 : 1), 0),
    };
  }
};

const handler = async (event, context) => {
  console.log("---event", event);
  console.log("---context", context);
  const logPrefix = "handler";
  const optsStack = { logPrefix };
  if (!process.env.DB_URI) {
    console.error("process.env.DB_URI not defined");
    throw Error("no DB_URI enviroment");
  }
  const client = new Client({ connectionString: process.env.DB_URI });
  try {
    await client.connect();
    optsStack.client = client;
    const { rows: orders } = await client.query(sqlOrderDashboard);
    const dashboard = genDashboardFromOrders(orders);
    const messageObj = {
      orders: dashboard,
      dashVer: 4,
    };
    if (event && event.WSS_ENDPOINT) {
      const { lastOrderId } = event;
      const maxOrderByDate = orders.reduce(
        (res, e) =>
          !res || (e.order_date && e.order_date > res.order_date) ? e : res,
        undefined
      );
      let response;
      if (!lastOrderId || lastOrderId != maxOrderByDate.gn_order_id) {
        const newLastOrderId = maxOrderByDate.gn_order_id;
        const newLastOrderDateEpoch = +maxOrderByDate.order_date / 1e3;
        const res = await postToAllConnections(
          optsStack,
          event.WSS_ENDPOINT,
          messageObj
        );
        response = {
          ...(res || {}),
          newLastOrderId,
          newLastOrderDateEpoch,
        };
      } else {
        response = {
          status: "SUCCESS",
          message: "lastOrderId not changed",
        };
      }
      console.log("RES: ", response);

      return response;
    } else {
      const response = messageObj;
      return await tryCompress(response, event);
    }
  } catch (err) {
    console.error(
      "%s: Error: %s\nStack: %s",
      logPrefix,
      err.message,
      err.stack
    );
  } finally {
    client.end();
  }
};

module.exports = { handler };
