"use strict";

require("dotenv").config();

if (process.env["AWS_PROFILE"]) {
  console.log("Using AWS profile: ", process.env["AWS_PROFILE"]);
}

const { exec } = require("child_process");
// const chromium = require("chrome-aws-lambda");
// const AWS = require("aws-sdk");
// const fs = require("fs");

const mydb = require("./lib/mydb");
const pp = require("./lib/pp");

let client; // global variable
let flagNeedShutdown = false; // flobal flag shutdown

process.on("beforeExit", (code) => {
  if (client) {
    console.log("beforeExit PG: try to Commit transaction");
    client.query("COMMIT").then(() => {
      console.log("beforeExit PG: transaction commited");
    });
  }
  // Can make asynchronous calls
  setTimeout(() => {
    console.log(`beforeExit PG: Process will exit with code: ${code}`);
    process.exit(code);
  }, 1000);
});

process.on("exit", (code) => {
  // Only synchronous calls
  console.log(`global ON exit: Process exited with code: ${code}`);
});

process.on("SIGINT", () => {
  if (client) {
    console.log("beforeExit PG: try to Commit transaction");
    client
      .query("COMMIT")
      .then(() => client.release())
      .then(() => {
        console.log(`Process ${process.pid} has been interrupted (commited)`);
        process.exit(0);
      });
    console.log(
      `global ON SIGINT: Process ${process.pid} will been interrupted`
    );
  } else {
    console.log(
      `global ON SIGINT: Process ${process.pid} has been interrupted (no client)`
    );
    process.exit(0);
  }
});

const sqlStoreGet = `
SELECT *
FROM "store"
WHERE true
-- AND "_date_updated" < CURRENT_TIMESTAMP - INTERVAL '1 HOUR'
ORDER BY "_date_updated" ASC
LIMIT 1
`;
const sqlProductsSelectByAsinAndStore = `
SELECT product_id, asin
FROM product
WHERE true
  AND "store_id" = $1
  AND "asin" = ANY($2::text[])
`;
const sqlProductsInsert = `
INSERT INTO "product" as p ("store_id", "asin", "title", "price", "star", "data")
SELECT 
  (z->>'store_id')::integer,
  z->>'asin',
  z->>'title',
  (z->>'price')::numeric,
  (z->>'star')::numeric,
  z->'data'
FROM jsonb_array_elements($1::jsonb) AS "z"
ON CONFLICT ON CONSTRAINT "uniq_store_asin" DO UPDATE
SET
  "store_id" = excluded.store_id,
  "title" = excluded.title,
  "price" = excluded.price,
  "star" = excluded.star,
  "data" = p."data" || excluded.data,
  "is_deleted" = false,
  "_date_updated" = CURRENT_TIMESTAMP
RETURNING "product_id", "asin"
`;
const sqlProductsUpdate = `
UPDATE "product" p
SET
  "store_id" = (z->>'store_id')::integer,
  "title" = z->>'title',
  "price" = (z->>'price')::numeric,
  "star" = (z->>'star')::numeric,
  "data" = p."data" || z->'data',
  "is_deleted" = false,
  "_date_updated" = CURRENT_TIMESTAMP
FROM jsonb_array_elements($1::jsonb) AS "z"
WHERE "p"."product_id" = (z->>'product_id')::integer
RETURNING "product_id", "asin"
`;
const sqlProductStoreDisableExcept = `
UPDATE "product" p
SET "is_deleted" = true
WHERE "store_id" = $1 AND NOT "product_id" = ANY($2::integer[])
RETURNING "product_id", "asin"`;
const worker = async (opts) => {
  const logPrefix = `${opts.logPrefix || ""} worker`.trim();
  const { client } = opts;
  const {
    rows: [store],
  } = await client.query(sqlStoreGet);
  if (!store) {
    console.log("%s No found store for worker", logPrefix);
    // prettier-ignore
    return { status: "OK", code: "NO_STORE", message: "No found store for worker" };
  }
  console.log(
    "%s loop store %s seller %s(%s) %s",
    logPrefix,
    store.store_id,
    store.name,
    store.seller_id,
    store.url
  );
  const browser = await pp.getBrowser();
  const page = await pp.firstPage(browser);
  let flagNextPage = false;
  const response = await page.goto(store.url, {
    waitUntil: "domcontentloaded",
  });
  const statusCode = response.status();
  if (statusCode !== 200) {
    return { status: "FAIL", statusCode };
  }
  {
    const content = await page.content();
    if (
      content.match(
        "Sorry! We couldn't find that page. Try searching or go to Amazon's home page."
      )
    ) {
      console.error("Page of store '%s' not found", store.name);
      return undefined;
    }
  }
  const cssProductRow =
    "span[data-component-type='s-search-results'] div.s-result-list div[data-asin]";
  const allProducts = [];
  // flagNextPage = true;
  // allProducts.push(...JSON.parse(fs.readFileSync("allProducts.json")));
  while (!flagNextPage) {
    // in PP: sels=Array.from(document.querySelectorAll(cssProductRow))
    // ((sels)=>sels.map(div=>{...}))(sels);
    // document.querySelectorAll(cssProductRow);
    const products = await page.$$eval(cssProductRow, (sels) =>
      sels
        .map((div) => {
          if (!div.getAttribute("data-asin")) return undefined;
          const res = { asin: div.getAttribute("data-asin") };
          // title
          {
            const titleBlock = div.querySelector("h2 a span.a-text-normal");
            if (titleBlock && titleBlock.innerText)
              res.title = titleBlock.innerText;
          } // star
          {
            const starBlock = div.querySelector("i.a-icon-star-small");
            if (starBlock && starBlock.innerText)
              res.star = starBlock.innerText;
          } // price
          {
            const priceBlock = div.querySelector(
              "span.a-price span.a-offscreen"
            );
            if (priceBlock && priceBlock.innerText)
              res.price = priceBlock.innerText;
          }
          // img
          {
            const imgBlock =
              div.querySelector(
                "span[data-component-type='s-product-image'] img"
              ) || div.querySelector("img");
            if (imgBlock && imgBlock.src) res.imgSrc = imgBlock.src;
            if (imgBlock && imgBlock.srcset) {
              try {
                res.imgSrcSets = Object.fromEntries(
                  imgBlock.srcset
                    .split(", ")
                    .map((str) => str.split(" ").reverse())
                );
              } catch (err) {
                console.error(err.message);
                res.imgSrcSet = imgBlock.srcset;
              }
            }
          }
          // link
          {
            const linkBlock = div.querySelector("a.a-link-normal");
            if (linkBlock && linkBlock.href) res.link = linkBlock.href;
          }
          return res;
        })
        .filter((e) => e)
    );
    if (products && products.length > 0) {
      allProducts.push(...products);
    }

    // find li.a-last
    const liLastOk = await page.$$eval(
      cssProductRow + " li.a-last",
      (sels) => sels && sels.length > 0
    );
    if (!liLastOk) {
      console.error("%s Button (list) 'Next ->' not found!", logPrefix);
      throw Error("FAIL");
    }
    if (
      await page.$$eval(
        cssProductRow + " li.a-last a",
        (sels) => sels && sels.length > 0
      )
    ) {
      console.log("%s fo to next page", logPrefix);
      await Promise.all([
        page.click(cssProductRow + " li.a-last a"),
        page.waitForNavigation({ waitUntil: "networkidle0" }),
      ]);
      await new Promise((res) => setTimeout(res, 1 * 1e3));
    } else {
      break;
    }
  }
  console.log(allProducts);
  // fs.writeFileSync("allProducts.json", JSON.stringify(allProducts));
  allProducts.map((e) => {
    if (e.star && typeof e.star == "string") {
      const matches = e.star.match(/\s*([\d.]+)\s*out of\s*([\d.]+)\s*star/);
      if (matches) {
        e.starValue = +matches[1];
        e.starMax = +matches[2];
      }
    }
    if (e.price && typeof e.price == "string") {
      const matches = e.price.match(/\$\s*([\d.]+)/);
      if (matches) {
        e.priceValue = +matches[1];
      }
    }
  });
  const prettyProducts = allProducts.filter((p) => p && p.asin && p.title);
  // determine product_id and update it
  {
    const { rows } = await client.query(sqlProductsSelectByAsinAndStore, [
      store.store_id,
      prettyProducts.map((p) => p.asin),
    ]);
    rows.map((row) => {
      prettyProducts
        .filter((p) => p.asin == row.asin)
        .map((p) => {
          p.product_id = row.product_id;
        });
    });
  }
  if (prettyProducts.some((p) => p.product_id)) {
    const prodArray = prettyProducts
      .filter((p) => p.product_id)
      .map((p) => ({
        store_id: store.store_id,
        product_id: p.product_id,
        title: p.title,
        asin: p.asin,
        price: p.priceValue || null,
        star: p.starValue || null,
        data: p,
      }));
    const { rows: rowsUpdated } = await client.query(sqlProductsUpdate, [
      JSON.stringify(prodArray),
    ]);
    console.log("%s rowsUpdated: ", logPrefix, rowsUpdated);
  } else {
    console.log("%s Nothing to update", logPrefix);
  }

  // do insert
  if (prettyProducts.some((p) => !p.product_id)) {
    const prodArray = prettyProducts
      .filter((p) => !p.product_id)
      .map((p) => ({
        store_id: store.store_id,
        title: p.title,
        asin: p.asin,
        price: p.priceValue || null,
        star: p.starValue || null,
        data: p,
      }));
    const { rows: rowsInserted } = await client.query(sqlProductsInsert, [
      JSON.stringify(prodArray),
    ]);
    console.log("%s rowsInserted: ", logPrefix, rowsInserted);
    rowsInserted.map((row) =>
      prettyProducts
        .filter((e) => e.asin == row.asin)
        .map((e) => {
          e.product_id = +row.product_id;
        })
    );
  } else {
    console.log("%s Nothing to insert", logPrefix);
  }
  // const { rows: rowsDeleted } =
  await client.query(sqlProductStoreDisableExcept, [
    store.store_id,
    prettyProducts.map((e) => +e.product_id).filter((e) => e),
  ]);
  // console.log("DEBUG rowsDeleted: ", rowsDeleted);
  // console.log("For debug");
};

const main = async (opts) => {
  const logPrefix = `${opts.logPrefix || ""} main`.trim();
  console.log("%s Main start", logPrefix);
  await mydb.updatePgConnection(opts);
  client = await mydb.getClient();
  let transactionBegin = false;
  try {
    await client.query("BEGIN");
    transactionBegin = true;
    // BEGIN block from main() loop
    await worker({ ...opts, client, logPrefix });
    // END block from main() loop
    console.log("TRY/CATCH. block. PG commit.");
    await client.query("COMMIT");
    transactionBegin = false;
  } catch (err) {
    if (transactionBegin) {
      console.log("TRY/CATCH. catch. PG commit.");
      await client.query("COMMIT");
      transactionBegin = false;
    }
    console.error("Got error: %s\nStack: %s", err.message, err.stack);
    console.log("delay 30.0 seconds for display error message... ");
    await new Promise((res) => setTimeout(res, 30 * 1e3));
  } finally {
    if (transactionBegin) {
      console.log("TRY/CATCH. finally. PG commit.");
      await client.query("COMMIT");
      transactionBegin = false;
    }
    console.log("TRY/CATCH: client release at now");
    await client.release();
  }
  client = undefined;
  if (flagNeedShutdown) {
    exec("sudo shutdown -P now");
    console.error("\n\n\n\nTHROTTLING !!! SHUTDOWN -P now.\n\n\n\n");
  }
  await new Promise((res) => setTimeout(res, 10 * 1e3));
};

main({});
