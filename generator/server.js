"use strict";

require("dotenv").config();

const AWS = require("aws-sdk");
const lambda = new AWS.Lambda();

const WSS_endpoint = process.env.WSS_ENDPOINT;
if (process.env.LAMBDANAME_DASHBOARD) {
  console.error("No LAMBDANAME_DASHBOARD enviroment");
  throw Error("No LAMBDANAME_DASHBOARD enviroment");
}

const sqlNextOrderDate = `
SELECT order_date, gn_order_id
FROM "gn_order" o
WHERE "order_date" > $1::timestamp with time zone
AND NOT gn_order_id = $2
ORDER BY "order_date" ASC
LIMIT 1
`;

const postToAllConnections = async (opts, messageObj) => {
  const { client, apigwManagementApi } = opts;
  const logPrefix = `${opts.logPrefix || ""} postToAllConnections`.trim();
  const messageStr = JSON.stringify(messageObj);
  //   const packed = require("jsonpack").pack(messageObj);
  //   console.log("%s Try sending packed message %s chars", logPrefix, packed.length);

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

  for (const connectionId of conn_ids) {
    console.log("%s post rows to %s", logPrefix, connectionId);
    try {
      await apigwManagementApi
        .postToConnection({
          ConnectionId: connectionId,
          Data: messageStr,
        })
        .promise();
    } catch (err) {
      console.error(
        "%s Failed WebSocket postToConnection %s\nError: %s\nStack: %s",
        logPrefix,
        connectionId,
        err.message,
        err.stack
      );
    }
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
    const resDashboard = await lambda
      .invoke({
        FunctionName: `adh-dev-lambdaDashboard-123NFLW7D5TST`,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify({
          WSS_ENDPOINT: process.env.WSS_ENDPOINT,
        }),
      })
      .promise();
    console.log("%s: lambda invoke: %s", logPrefix, resDashboard);
    const { newLastOrderId, newLastOrderDateEpoch } = resDashboard.Payload
      ? JSON.parse(resDashboard.Payload)
      : {};
    const lastOrderDate = newLastOrderDateEpoch
      ? new Date(newLastOrderDateEpoch * 1e3)
      : undefined;
    if (newLastOrderId) {
      console.log(
        "%s: update last order id from %s to %s",
        logPrefix,
        lastOrderId,
        newLastOrderId
      );
      lastOrderId = newLastOrderId;
    }

    // определяем необходимую задержку перед следующим вызовом
    console.log("try find order with date > %s", lastOrderDate);
    const { rows: rowsNextOrder } = await client.query(sqlNextOrderDate, [
      lastOrderDate,
      newLastOrderId,
    ]);
    if (rowsNextOrder.length === 0) {
      console.log("No order in the future");
      needDelay = 1e3;
      if (opts.cbCreateNewOrders) {
        await postToAllConnections(optsStack, {
          status: { message: "now generate orders" },
        });
        opts.cbCreateNewOrders(optsStack);
      } else {
        console.log("no function opts.'cbCreateNewOrders'");
      }
      continue;
    }
    const nextOrder = rowsNextOrder[0];
    console.log("nextOrder #%s last #%s", nextOrder.gn_order_id, lastOrderId);
    needDelay = nextOrder.order_date - Date.now();
    if (needDelay > 6 * 60 * 1e3) {
      console.log("Very big delay between order");
      needDelay = 1e3;
      if (opts.cbCreateNewOrders) {
        await postToAllConnections(optsStack, {
          status: { message: "now generate orders" },
        });
        await opts.cbCreateNewOrders(optsStack);
      } else {
        console.log("no function opts.'cbCreateNewOrders'");
      }
      continue;
    }

    await postToAllConnections(optsStack, {
      status: { nextDelay: +(needDelay / 1e3).toFixed(1) },
    });
    // delay loop
  }
};
module.exports = { serverWorker };
