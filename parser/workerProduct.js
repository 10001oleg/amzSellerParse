"use strict";

require("dotenv").config();

// const { exec } = require("child_process");

// if (process.env["AWS_PROFILE"]) {
//   console.log("Using AWS profile: ", process.env["AWS_PROFILE"]);
// }
// const AWS = require("aws-sdk");
const fs = require("fs");

const mydb = require("./lib/mydb");
const mFunc = require("./lib/mFunc");
// const pp = require("./lib/pp");
const { handler: requestAmazon } = require("./lib/requestAmazon");

const creds = JSON.parse(fs.readFileSync("./amazon_creds.json"));
const getCred = async (opts) => {
  const logPrefix = `${opts.logPrefix || ""} getCred`.trim();
  for (;;) {
    // throttling workaround:
    const credCandidate = creds.filter(
      (e) => (e && !e.lastUsed) || e.lastUsed > Date.now() - 5e3
    );
    if (credCandidate.length > 0) return credCandidate[0];
    console.log("%s throttling wait 1 sec", logPrefix);
    await new Promise((res) => setTimeout(res, 5e3));
  }
};
const sqlAmzProductSelectForUpdate = `
SELECT *
FROM "product"
WHERE "mws_product_lastupdate" IS NULL OR "mws_product_lastupdate" < CURRENT_TIMESTAMP - INTERVAL '1 HOUR' -- TODO increase interval
ORDER BY mws_product_lastupdate ASC NULLS FIRST
LIMIT 1
FOR UPDATE SKIP LOCKED
`;
const sqlAmzProductUpdateLastUpdate = `
UPDATE "product"
SET mws_product_lastupdate = CURRENT_TIMESTAMP
WHERE "product_id" = $1
`;
const sqlAmzProductUpdate = `
UPDATE "product"
SET
  "mws_product" = $2,
  "mws_product_lastupdate" = CURRENT_TIMESTAMP
WHERE "asin" = $1
`;
const workerAmzProductUpdater = async (opts) => {
  const logPrefix = `${opts.logPrefix || ""} workerAmzProductUpdater`.trim();
  console.log("%s start", logPrefix);
  await mydb.updatePgConnection(opts);
  for (;;) {
    console.log("%s for loop", logPrefix);
    const optsStack = { ...opts, logPrefix };
    await mydb.trxWrap(optsStack, async (client) => {
      console.log("%s trxWrap", logPrefix);
      const { rows } = await client.query(sqlAmzProductSelectForUpdate);
      if (!(rows.length > 0)) return;
      const cred = await getCred(optsStack);
      const asins = [rows[0].asin];
      const { product_id } = rows[0];
      await client.query(sqlAmzProductUpdateLastUpdate, [product_id]);

      const resRequestReport = await requestAmazon(
        optsStack,
        { cred },
        { path: "/Products/2011-10-01" },
        {
          Action: "GetMatchingProductForId",
          IdType: "ASIN",
          ...Object.fromEntries(asins.map((e, i) => [`IdList.Id.${i + 1}`, e])),
        }
      );
      cred.lastUsed = Date.now();
      if (
        !resRequestReport ||
        !resRequestReport.body ||
        !resRequestReport.body.GetMatchingProductForIdResponse ||
        !resRequestReport.body.GetMatchingProductForIdResponse
          .GetMatchingProductForIdResult
      ) {
        console.log("%s Failed request...", logPrefix);
        return;
      }
      const responses = mFunc.forceArray(
        resRequestReport.body.GetMatchingProductForIdResponse
          .GetMatchingProductForIdResult
      );
      console.log(responses);
      const asinsData = responses.map((response) => {
        const { Id, status } = response;
        if (status !== "Success") {
          return { asin: Id, status, data: { error: response.Error } };
        }

        const resItem = JSON.parse(
          JSON.stringify(
            mFunc.forceArray(response.Products)[0].Product
          ).replace(/ns[0-9]*:/g, "")
        );
        resItem.Identifiers = mFunc.forceArray(resItem.Identifiers);

        // Relationships
        // if (resItem.Relationships.BaseRelationship) {
        //   resItem.Relationships = mFunc.forceArray(
        //     resItem.Relationships.BaseRelationship
        //   );
        // } else if (Object.keys(resItem.Relationships).length == 0) {
        //   resItem.Relationships = []; // nothing
        // } else {
        //   console.log("Breakpoint");
        //   resItem.Relationships = [];
        // }

        // AttributeSets
        if (resItem.AttributeSets.ItemAttributes) {
          resItem.AttributeSets = mFunc.forceArray(
            resItem.AttributeSets.ItemAttributes
          );
        } else if (Object.keys(resItem.AttributeSets).length == 0) {
          resItem.AttributeSets = []; // nothing
        } else {
          console.log("Breakpoint");
          resItem.AttributeSets = [];
        }

        // SalesRankings
        if (resItem.SalesRankings.SalesRank) {
          resItem.SalesRankings = mFunc.forceArray(
            resItem.SalesRankings.SalesRank
          );
        } else if (Object.keys(resItem.SalesRankings).length == 0) {
          resItem.SalesRankings = []; // nothing
        } else {
          console.log("Breakpoint");
          resItem.SalesRankings = [];
        }
        return { asin: Id, status, data: resItem };
      });

      for (const { data, asin } of asinsData) {
        await client.query(sqlAmzProductUpdate, [asin, data]);
      }
    });
  }
};

workerAmzProductUpdater({});
