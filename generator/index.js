"use strict";
const server = require("./server");
const genOrder = require("./genOrder");
const mydb = require("./lib/mydb");

const sqlStoreSelect = `
SELECT *
FROM "store"
WHERE NOT "data" ? 'disabled'
`;
const orderHistogram = [
  { h: 0, v: 8484 },
  { h: 1, v: 8068 },
  { h: 2, v: 8617 },
  { h: 3, v: 6386 },
  { h: 4, v: 5071 },
  { h: 5, v: 3565 },
  { h: 6, v: 2395 },
  { h: 7, v: 1647 },
  { h: 8, v: 1301 },
  { h: 9, v: 1078 },
  { h: 10, v: 1648 },
  { h: 11, v: 2886 },
  { h: 12, v: 5257 },
  { h: 13, v: 7673 },
  { h: 14, v: 9421 },
  { h: 15, v: 11246 },
  { h: 16, v: 11879 },
  { h: 17, v: 12264 },
  { h: 18, v: 11970 },
  { h: 19, v: 11600 },
  { h: 20, v: 10772 },
  { h: 21, v: 10138 },
  { h: 22, v: 9246 },
  { h: 23, v: 9135 },
];
let createNewOrderLocked = false;
const cbCreateNewOrders = async (opts) => {
  const logPrefix = `${opts.logPrefix || ""} cbCreateNewOrders`.trim();
  if (createNewOrderLocked) {
    console.error("%s: createNewOrderLocked", logPrefix);
    return undefined;
  }
  try {
    createNewOrderLocked = true;
    return await cbCreateNewOrdersImpl(opts);
  } catch (err) {
    createNewOrderLocked = false;
    throw err;
  } finally {
    createNewOrderLocked = false;
  }
};

const cbCreateNewOrdersImpl = async (opts) => {
  const logPrefix = `${opts.logPrefix || ""} cbCreateNewOrdersImpl`.trim();
  console.log("%s Start generate orders...", logPrefix);
  const { client } = opts;
  const { rows: stores } = await client.query(sqlStoreSelect);
  const curDate = new Date();
  const curHour = curDate.getUTCHours();
  const hourK =
    (orderHistogram.filter((e) => e.h == curHour)[0].v * 1.0) /
    orderHistogram.reduce((sum, { v }) => sum + v, 0);
  console.log("%s curHour ", logPrefix, curHour),
    orderHistogram.reduce((sum, { v }) => sum + v, 0);

  for (const storeData of stores) {
    console.log(
      "%s Start generate orders for store #%s (%s)...",
      logPrefix,
      storeData.store_id,
      storeData.seller_id
    );
    console.log(storeData);
    const {
      data: { orderCountPerDay },
    } = storeData;
    let hourOrderCount = Math.round(
      orderCountPerDay * hourK * (1 + (Math.random() - 0.5) * 0.1)
    );
    console.log(
      "%s  need %s orders (per day %s, hourK: %s)",
      logPrefix,
      hourOrderCount,
      orderCountPerDay,
      hourK
    );
    if (hourOrderCount < 1) continue;
    for (let i = 0; i < hourOrderCount; i++) {
      // generate date of current Order
      // 0 .. 3600
      const orderInterval = 3600.0 / hourOrderCount;
      const orderIntervalStart = i * orderInterval;
      // const orderIntervalEnd = orderIntervalStart + orderInterval;

      const secOfHour = Math.min(
        3600,
        Math.max(0, Math.random() * orderInterval + orderIntervalStart)
      );
      const res = await genOrder.generateOneOrder(
        { ...opts, logPrefix },
        undefined,
        { store_id: storeData.store_id, orderDate: +curDate + secOfHour * 1e3 }
      );
      if (!(res && res.order_date)) {
        console.log("%s Failed create new order...", logPrefix);
      }
      console.log("%s generateOneOrder: ", logPrefix, res && res.order_date);
    }
  }
};

const main = async (opts = {}) => {
  await mydb.updatePgConnection({ ...opts });
  opts.client = mydb;

  server.serverWorker({ ...opts, cbCreateNewOrders });
};
main();
