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

const creds = JSON.parse(fs.readFileSync(`${__dirname}/amazon_creds.json`));
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
--WHERE "data" ? 'pack' -- FOR DEBUG
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
  "data" = "data" || $3,
  "mws_product_lastupdate" = CURRENT_TIMESTAMP
WHERE "asin" = $1
`;
const sqlAmzCategoriesByIds = `
SELECT "category_id", "name"
FROM "amazon_category"
WHERE "category_id" = ANY ($1::text[])
`;

const sqlAmzCategoryInsertOrUpdate = `
INSERT INTO "amazon_category" as ac (
  "category_id",
  "name",
  "parent_id",
  "data",
  "lastupdate"
)
SELECT
  z->>'category_id',
  z->>'name',
  z->>'parent_id',
  z->'data',
  CURRENT_TIMESTAMP
FROM jsonb_array_elements($1::jsonb) z
ON CONFLICT ("category_id") DO UPDATE
SET
  "name" = excluded."name",
  "parent_id" = excluded."parent_id",
  "data" = ac."data" || excluded."data",
  "lastupdate" = CURRENT_TIMESTAMP
WHERE NOT (
   COALESCE(ac."name",'') <> excluded."name" AND
   COALESCE(ac."parent_id",'') <> excluded."parent_id" AND
   excluded."data" = '{}'::jsonb
)
RETURNING "category_id", "name", "parent_id"

`;

const amzUpdateCategoriesByProductASIN = async (
  opts,
  cred,
  asin,
  categories = []
) => {
  const logPrefix = `${opts.logPrefix || ""} workerAmzProductUpdater`.trim();
  const optsStack = { ...opts, logPrefix };
  const client = opts.client;
  try {
    const resRequestReport = await requestAmazon(
      optsStack,
      { cred },
      { path: "/Products/2011-10-01" },
      {
        Action: "GetProductCategoriesForASIN",
        ASIN: asin,
      }
    );
    if (resRequestReport && resRequestReport.statusMessage == "Nothing Data") {
      console.log("%s Nothing to response. Increase wait delay", logPrefix);
      return;
    }
    if (
      !resRequestReport ||
      !resRequestReport.body ||
      !resRequestReport.body.GetProductCategoriesForASINResponse ||
      !resRequestReport.body.GetProductCategoriesForASINResponse
        .GetProductCategoriesForASINResult
    ) {
      console.log("%s Failed request...", logPrefix);
      return;
    }
    const tmpResponses =
      resRequestReport.body.GetProductCategoriesForASINResponse
        .GetProductCategoriesForASINResult;
    const responses = mFunc.forceArray(
      tmpResponses.Self ? tmpResponses.Self : tmpResponses
    );
    const category_list = []; // {category_id, name, parent_id, data}

    console.log("product %s categories: ", asin, JSON.stringify(responses));
    for (const startTreeItem of responses) {
      let item = startTreeItem;
      for (let depth = 0; depth < 20; depth++) {
        if (!item) break;
        const Parent = item.Parent;
        if (
          !category_list.some((e) => e.category_id == item.ProductCategoryId)
        ) {
          category_list.push({
            category_id: item.ProductCategoryId,
            name: item.ProductCategoryName,
            parent_id:
              Parent && Parent.ProductCategoryId
                ? Parent.ProductCategoryId
                : null,
            data: item.Parent ? { Parent: item.Parent } : {},
          });
        }
        if (!Parent) break;
        item = Parent;
      }
    }
    const response = {};
    if (category_list.length > 0) {
      const categoriesDbUpdates = category_list.filter((catData) => {
        const fltList = categories.filter(
          (e) => e.category_id == catData.category_id
        );
        if (fltList.length == 0) return true;
        if (
          fltList[0] &&
          fltList[0].name &&
          fltList[0].name == catData.name &&
          fltList[0].parent_id &&
          fltList[0].parent_id == catData.parent_id &&
          true
        )
          return false;
        return true;
      });
      if (categoriesDbUpdates.length > 0) {
        const { rows } = await client.query(sqlAmzCategoryInsertOrUpdate, [
          JSON.stringify(categories),
        ]);
        response.categoryListUpdates = rows;
      }
    }
    response.categories = responses
      .map((e) => e.ProductCategoryId)
      .filter((e) => e);

    return response;
  } catch (err) {
    console.log("Error: %s\nSTack: %s", err.message, err.stack);
    throw err;
  }
};

const updateCategoriesCache = (categories, categoriesUpdates) => {
  for (const updates of categoriesUpdates) {
    const candidates = categories.filter(
      (e) => e.category_id == updates.category_id
    );
    let needAdd = true;
    candidates.map((e) => {
      needAdd = false;
      e.name = updates.name;
      e.parent_id = updates.parent_id;
      e.data = { ...(e.data || {}), ...(updates.data || {}) };
    });
    if (needAdd) {
      // console.log("Insert category id into cache %s", updates.category_id);
      categories.push(updates);
    }
  }
};

// GetProductCategoriesForASINResult
const workerAmzProductUpdater = async (opts) => {
  const logPrefix = `${opts.logPrefix || ""} workerAmzProductUpdater`.trim();
  console.log("%s start", logPrefix);
  await mydb.updatePgConnection(opts);
  for (;;) {
    console.log("%s for loop", logPrefix);
    const optsStack = { ...opts, logPrefix };
    const { rows } = await mydb.query(sqlAmzProductSelectForUpdate);
    if (!(rows.length > 0)) {
      console.log("%s nothing product for update. wait 30sec", logPrefix);
      await new Promise((res) => setTimeout(res, 30e3));
      return;
    }

    await mydb.trxWrap(optsStack, async (client) => {
      console.log("%s trxWrap", logPrefix);
      const cred = await getCred(optsStack);
      const asins = [rows[0].asin];
      const { product_id, data: productData } = rows[0];
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
      // console.log(responses);
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
        const packObj = resItem.AttributeSets.reduce((packObj, attrSet) => {
          if (packObj) return packObj;
          if (!attrSet) return undefined;
          if (typeof attrSet != "object") return undefined;

          const itemDim =
            attrSet.PackageDimensions &&
            Array.isArray(attrSet.PackageDimensions)
              ? attrSet.PackageDimensions[0]
              : attrSet.PackageDimensions;
          if (!itemDim) return undefined;
          const keys = ["Width", "Height", "Length", "Weight"];
          for (const key of keys) {
            if (!itemDim[key]) {
              // prettier-ignore
              console.log("%s product ASIN %s no key %s", logPrefix, Id, key);
              return undefined;
            }
            if (!itemDim[key]["$t"] || !(+itemDim[key]["$t"] > 0.01)) {
              // prettier-ignore
              console.log("%s product ASIN %s no key %s value '$t'", logPrefix, Id, key);
              return undefined;
            }
            if (!itemDim[key]["Units"]) {
              // prettier-ignore
              console.log("%s product ASIN %s no key %s value 'Units'", logPrefix, Id, key);
              return undefined;
            }
            if (
              itemDim[key]["Units"] !== (key == "Weight" ? "pounds" : "inches")
            ) {
              // prettier-ignore
              console.log("%s product ASIN %s no key %s value 'Units' value wrong", logPrefix, Id, key);
              return undefined;
            }
          }
          return {
            width: +(+itemDim.Width["$t"]).toFixed(2),
            height: +(+itemDim.Height["$t"]).toFixed(2),
            length: +(+itemDim.Length["$t"]).toFixed(2),
            weight: +(+itemDim.Weight["$t"]).toFixed(2),
          };
        }, undefined);

        const salesRankings = mFunc.forceArray(resItem.SalesRankings);
        return { asin: Id, status, data: resItem, packObj, salesRankings };
      });

      const categoriesId = asinsData.flatMap((e) =>
        e.salesRankings.map((c) => c.ProductCategoryId)
      );
      const { rows: categories } =
        categoriesId.length > 0
          ? await client.query(sqlAmzCategoriesByIds, [[categoriesId]])
          : { rows: [] };

      const ONE_DAY_IN_MS = 24 * 3600 * 1e3;
      for (const curObject of asinsData) {
        const { data: mws_product, asin, packObj, salesRankings } = curObject;
        const dataUpdates = {};
        let flagNeedGetCategories =
          !productData.categories ||
          !productData.categoriesLastUpdate ||
          +productData.categoriesLastUpdate < Date.now() - ONE_DAY_IN_MS;

        // amzProductCategories
        // Узнаем есть ИД категорий, которые отсутсвуют в базе ли с пустыми именами
        const productCategoriesNull = salesRankings
          .map(({ ProductCategoryId }) => {
            if (!ProductCategoryId.match(/^[0-9]+$/)) return;
            const names = categories.filter(
              (e) => e.category_id == ProductCategoryId && e.name
            );
            if (names.length == 0) return ProductCategoryId;
          })
          .filter((e) => e);
        if (productCategoriesNull.length > 0) {
          flagNeedGetCategories = true;
        }
        if (flagNeedGetCategories) {
          const res = await amzUpdateCategoriesByProductASIN(
            { ...optsStack, client },
            cred,
            asin,
            categories
          );
          if (res) {
            const { categories, categoryListUpdates } = res;
            if (categoryListUpdates && Array.isArray(categoryListUpdates)) {
              updateCategoriesCache(categories, categoryListUpdates);
            }
            if (categories && Array.isArray(categories)) {
              dataUpdates.categories = categories;
              dataUpdates.categoriesLastUpdate = Date.now();
            }
          }
        }
        const ranks = salesRankings
          .map(({ ProductCategoryId, Rank }) => {
            if (!ProductCategoryId) return undefined;
            const names = categories
              .filter((e) => e.category_id == ProductCategoryId && e.name)
              .map((e) => e.name);
            if (names.length == 0) return undefined;
            return {
              id: ProductCategoryId,
              name: names[0],
              rank: +Rank > 0 ? +Rank : Rank,
            };
          })
          .filter((e) => e);

        if (packObj) dataUpdates.pack = packObj;
        if (ranks && ranks.length > 0) dataUpdates.ranks = ranks;
        console.log(
          "%s ranks: ",
          asin,
          JSON.stringify(ranks),
          "  \n",
          JSON.stringify(dataUpdates)
        );
        await client.query(sqlAmzProductUpdate, [
          asin,
          mws_product, // mws_product fields
          dataUpdates, // data field updates
        ]);
      }
      console.log("trxWrap end");
    });
  }
};

workerAmzProductUpdater({});
