"use strict";
const util = require("util");

const apiRates = {
  UPS: require("./carrier/UPS/rates"),
  JFEDEX: require("./carrier/JFEDEX/rates"),
};

const fs = require("fs");
const carrierAccounts = JSON.parse(
  fs.readFileSync(__dirname + "/carrierAccounts.json")
);

const sqlProductRnd = `
SELECT
  "product_id",
  "star",
  "data"->'pack' as pack
  -- ,SUM(star) OVER(rows between unbounded preceding and current row) as star_paging
FROM "product"
WHERE true
  AND "star" > 0
  AND "price" > 0
  AND NOT "is_deleted"
  AND "data" ? 'pack'
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
const sqlParamSelectOrderProduct = `
SELECT *
FROM "param"
WHERE "v"->>'type' = 'orderProduct'
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

const sqlRandomAddress = `
SELECT *
FROM "address"
ORDER BY RANDOM() 
LIMIT 10
`;
const sqlAddressUseCountIncrement = `
UPDATE "address"
SET "use_count" ="use_count" +1
WHERE "wh_order_id" = $1::integer
`;

const warehouses = [
  {
    code: "OC",
    probability: 60,
    ship_address: {
      CountryCode: "US",
      PostalCode: "90058-3453",
      StateOrRegion: "CA",
      City: "Vernon",
      AddressType: "Commercial",
    },
  },
  {
    code: "GA1",
    probability: 40,
    ship_address: {
      CountryCode: "US",
      PostalCode: "30071",
      StateOrRegion: "GA",
      City: "NORCROSS",
      AddressType: "Commercial",
    },
  },
];
const generateOneOrder = async (
  opts,
  genQtyParam = defOrderRandom,
  filter = {}
) => {
  const logPrefix = `${opts.logPrefix || ""} generateOneOrder`.trim();
  const optsStack = {
    ...opts,
    logPrefix,
    client: {
      query: () => {
        throw Error("NEED TO DELETE CODE");
      },
    },
  };
  const client = opts.client;
  if (!client) {
    throw Error("opts.client required!");
  }
  const { rows: params } = await client.query(sqlParamSelectOrderProduct);

  const { rows: dirtyProducts } = await client.query(sqlProductRnd, [
    filter && filter.store_id ? filter.store_id : null,
  ]);

  const dbProducts = dirtyProducts.filter((prod) => {
    const pack = prod.pack;
    for (const { v } of params) {
      if ("weightMin" in v || "weightMax" in v) {
        if (!pack) return false;
        if (!pack.weight) {
          return false;
        }
        if ("weightMin" in v && v.weightMin > pack.weight) {
          return false;
        }
        if ("weightMax" in v && v.weightMax < pack.weight) {
          return false;
        }
      }
      if ("dimMin" in v || "dimMax" in v) {
        if (!pack) return false;
        if (!pack.height || !pack.width || !pack.length) {
          return false;
        }
        if (
          "dimMin" in v &&
          (v.dimMin > pack.height ||
            v.dimMin > pack.width ||
            v.dimMin > pack.length)
        ) {
          return false;
        }
        if (
          "dimMax" in v &&
          (v.dimMax < pack.height ||
            v.dimMax < pack.width ||
            v.dimMax < pack.length)
        ) {
          return false;
        }
      }
    }
    return true;
  });
  if (dbProducts.length < 1) {
    console.log(
      "%s Nothing product to generate orders, store #%s",
      logPrefix,
      filter.store_id
    );
    return;
  }
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

  // generate randon buyer address
  for (let attempt = 0; attempt < 10; attempt++) {
    const { rows } = await client.query(sqlRandomAddress);
    const filterAddresses = rows.filter(
      ({ ship_address }) =>
        ship_address &&
        ship_address.StateOrRegion &&
        typeof ship_address.StateOrRegion == "string" &&
        ship_address.StateOrRegion.length == 2 &&
        ship_address.PostalCode
    );
    if (filterAddresses.length == 0) continue;
    const { ship_address, wh_order_id } = filterAddresses[0];
    orderObj.ship_address = ship_address;
    await client.query(sqlAddressUseCountIncrement, [wh_order_id]); // update increment "use_count field"
    break;
  }
  // const selectedWH = randomWeighted(
  //   warehouses.map((v) => ({ w: v.probability, v }))
  // );
  // if (!selectedWH) throw Error("Can not selection ");
  // orderObj.whObj = { ...selectedWH.ship_address, code: selectedWH.code };

  const packages = items.flatMap((e) => {
    const res = [];
    for (let i = 0; i < +e.qty; i++) {
      res.push({
        weight: e.productObj.data.pack.weight,
        dimensions: {
          width: e.productObj.data.pack.width,
          height: e.productObj.data.pack.height,
          length: e.productObj.data.pack.length,
        },
      });
    }
    return res;
  });
  console.log("Order packages: ", packages);
  const objRequest = {
    dropoffType: "REGULAR_PICKUP",
    packagingType: "YOUR_PACKAGING", // or FEDEX_ENVELOPE default YOUR_PACKAGING
    shippingChargesPayment: "SENDER", // or THIRD_PARTY (not use)
    shipper: { contact: {}, address: {} },
    recipient: { contact: {}, address: {} },
    packages,
  };
  // prettier-ignore
  {
    if (orderObj.ship_address.CountryCode)   objRequest.recipient.address.countryCode = orderObj.ship_address.CountryCode;
    if (orderObj.ship_address.PostalCode)    objRequest.recipient.address.postalCode =  orderObj.ship_address.PostalCode;
    if (orderObj.ship_address.StateOrRegion) objRequest.recipient.address.stateOrProvinceCode = orderObj.ship_address.StateOrRegion;
    if (orderObj.ship_address.City)          objRequest.recipient.address.city =        orderObj.ship_address.City;
    if (orderObj.ship_address.AddressLine1)  objRequest.recipient.address.streetLine1 = orderObj.ship_address.AddressLine1;
    if (orderObj.ship_address.AddressLine2)  objRequest.recipient.address.streetLine2 = orderObj.ship_address.AddressLine2;
    if (orderObj.ship_address.AddressLine3)  objRequest.recipient.address.streetLine3 = orderObj.ship_address.AddressLine3;
    if (orderObj.ship_address.AddressType)   {
      objRequest.recipient.address.residential = orderObj.ship_address.AddressType.match(/Residential/i)?true:false;
    } else {
      objRequest.recipient.address.residential = true;
    }
  }

  //determine lower price
  const whRates = [];
  for (const whObj of warehouses) {
    const carrierRates = await Promise.all(
      carrierAccounts.map(async (carrierData) => {
        const { carrier_type } = carrierData;
        carrierData.carrier_id = -1;
        const myRequest = JSON.parse(JSON.stringify(objRequest));
        // prettier-ignore
        {
          if (whObj.ship_address.CountryCode)   myRequest.shipper.address.countryCode = whObj.ship_address.CountryCode;
          if (whObj.ship_address.PostalCode)    myRequest.shipper.address.postalCode =  whObj.ship_address.PostalCode;
          if (whObj.ship_address.StateOrRegion) myRequest.shipper.address.stateOrProvinceCode = whObj.ship_address.StateOrRegion;
          if (whObj.ship_address.City)          myRequest.shipper.address.city =        whObj.ship_address.City;
          if (whObj.ship_address.AddressLine1)  myRequest.shipper.address.streetLine1 = whObj.ship_address.AddressLine1;
          if (whObj.ship_address.AddressLine2)  myRequest.shipper.address.streetLine2 = whObj.ship_address.AddressLine2;
          if (whObj.ship_address.AddressLine3)  myRequest.shipper.address.streetLine3 = whObj.ship_address.AddressLine3;
          if (whObj.ship_address.AddressType)   {
            myRequest.shipper.address.residential = whObj.ship_address.AddressType.match(/Residential/i)?true:false;
          } else {
            myRequest.shipper.address.residential = true;
          }
        }

        const rates = await apiRates[carrier_type].handler(
          { ...optsStack, carrierData },
          undefined,
          myRequest
        );

        const minRate = rates
          .filter((e) => e && e.ServiceType && e.ServiceType.match(/GROUND/i))
          .reduce((minRate, rate) => {
            if (!rate || !rate.TotalNetChargeWithDutiesAndTaxes) return minRate;
            const total = +rate.TotalNetChargeWithDutiesAndTaxes;
            if (!minRate || !minRate.total || minRate.total > total) {
              return {
                total,
                rate,
              };
            }
            return minRate;
          }, {});

        return {
          carrier_type: carrierData.carrier_type,
          rate: minRate ? minRate.rate : undefined,
          total: minRate ? minRate.total : undefined,
        };
      })
    );

    const minWhRate = carrierRates.reduce(
      (acc, rate) =>
        !acc || !acc.total || acc.total > rate.total ? rate : acc,
      undefined
    );
    whRates.push({
      whObj,
      carrier_type: minWhRate ? minWhRate.carrier_type : undefined,
      rate: minWhRate ? minWhRate.rate : undefined,
      total: minWhRate ? minWhRate.total : undefined,
    });
  }
  console.log(whRates);

  const resWhAndRates = whRates.reduce((acc, whRate) => {
    if (!whRate || !whRate.whObj || !whRate.total) return acc;
    if (!acc || !acc.total) return whRate;
    if (acc.total > whRate.total) return whRate;
    return acc;
  }, undefined);
  if (!resWhAndRates || !resWhAndRates.whObj || !resWhAndRates.total) {
    console.error("%s can not be determine optimate WH", logPrefix);
    return;
  }
  orderObj.whObj = resWhAndRates.whObj;
  orderObj.rates = {
    total: resWhAndRates.total,
    carrier_type: resWhAndRates.carrier_type,
    carrier_rate: resWhAndRates.rate,
  };
  //workaround JFEDEX
  if (orderObj.rates && orderObj.rates.carrier_type)
    orderObj.rates.carrier_type = orderObj.rates.carrier_type.replace(
      /^JFEDEX/,
      "FEDEX"
    );

  const { rows: rowsOrderInsert } = await client.query(sqlGnOrderInsert, [
    util.format(
      "11%s-%s%s%s****-*******",
      Math.trunc(Math.random() * 4) + 1,
      Math.trunc(Math.random() * 9) + 1,
      Math.trunc(Math.random() * 10),
      Math.trunc(Math.random() * 10)
    ),
    filter && filter.orderDate ? new Date(filter.orderDate) : null, //new Date(),
    orderObj.store_id,
    JSON.stringify(items),
    JSON.stringify(orderObj.ship_address), // ship_address
    JSON.stringify(orderObj.whObj), // whObj
    JSON.stringify({
      carrier_type: orderObj.rates.carrier_type,
      carrier_total: orderObj.rates.total,
      carrier_rates: orderObj.rates.carrier_rate,
    }),
  ]);
  console.log("%s OrderInserted: ", logPrefix, rowsOrderInsert);
  return rowsOrderInsert[0];
};

module.exports = { generateOneOrder };
