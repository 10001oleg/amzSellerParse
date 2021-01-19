"use strict";

const chromium = require("chrome-aws-lambda");

var browserGlobal;

const getBrowser = async () => {
  try {
    if (
      browserGlobal &&
      browserGlobal.isConnected() &&
      (await browserGlobal.pages())
    ) {
      console.log("puppeteer reusing");
      return browserGlobal;
    }
    throw Error("xxx");
  } catch (err) {
    console.log("puppeteer starting");
    browserGlobal = await chromium.puppeteer.launch({
      args: [...chromium.args, "--start-maximized"],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
      // headless: true,
      ignoreHTTPSErrors: true,
    });
    console.log("puppeteer started");
  }
  return browserGlobal;
};

const closeBrowser = async (browser) => {
  browserGlobal = undefined;
  await browser.close();
};

const firstPage = async (browser) => {
  let page;
  if (!page && "pages" in browser) {
    const pages = await browser.pages();
    if (pages.length > 0) page = pages[0];
  }
  if (!page && "target" in browser) {
    let target;
    if ((target = await browser.target())) {
      page = await target.page();
    } //= await browser.newPage();
  }

  if (!page) page = await browser.newPage();
  if (!page) {
    console.error("Can not get page or open new one");
    throw Error("Can not get Browser Page");
  }
  // await page.setViewport({ width: 0, height: 0 });
  // await page.goto("about:blank", { waitUntil: "domcontentloaded" });
  // await page.setViewport({ width: 0, height: 0 });
  //   page.on("request", (request) => {
  //     if (request.resourceType() === "image") request.abort();
  //     else request.continue();
  //   });
  await page.setRequestInterception(true);
  page.on("request", (interceptedRequest) => {
    if (
      interceptedRequest.url().endsWith(".png") ||
      interceptedRequest.url().endsWith(".jpg")
    )
      interceptedRequest.abort();
    else interceptedRequest.continue();
  });

  return page;
};

const newPage = async (browser) => {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (interceptedRequest) => {
    if (
      interceptedRequest.url().endsWith(".png") ||
      interceptedRequest.url().endsWith(".jpg")
    )
      interceptedRequest.abort();
    else interceptedRequest.continue();
  });
  return page;
};

const selectorCount = (page, selector) =>
  page.$$eval(selector, (sels) => sels.length);

const selectorsCountMax = (page, selectors) =>
  Promise.all(selectors.map((selector) => selectorCount(page, selector))).then(
    (counts) => counts.reduce((a, e) => (a > e ? a : e)),
    0
  );

const selectorWait = async (
  page,
  selector,
  maxDelay = 3000,
  interval = 100,
  makeErrorIfFalse = true
) => {
  const startTime = +new Date();
  while (
    !((await selectorCount(page, selector)) > 0) &&
    startTime + maxDelay > +new Date()
  ) {
    console.log("selectorWait '%s' delay %s", selector, interval);
    await new Promise((res) => setTimeout(res, interval));
  }
  const result = (await selectorCount(page, selector)) > 0;
  if (!result && makeErrorIfFalse) {
    // await uploadScreenShot(page);
    throw Error(`Can not make selector: '${selector}'`);
  }
  return result;
};

const selectorsAnyWait = async (
  page,
  selectors,
  maxDelay = 3000,
  interval = 100,
  makeErrorIfFalse = true
) => {
  const selectorsStr = selectors.map((e) => `'${e}'`).join(",");
  const startTime = +new Date();
  while (
    !((await selectorsCountMax(page, selectors)) > 0) &&
    startTime + maxDelay > +new Date()
  ) {
    console.log("selectorWait '%s' delay %s", selectorsStr, interval);
    await new Promise((res) => setTimeout(res, interval));
  }
  const result = (await selectorsCountMax(page, selectors)) > 0;
  if (!result && makeErrorIfFalse) {
    // await uploadScreenShot(page);
    throw Error(`Can not make selector: '${selectorsStr}'`);
  }
  return result;
};
module.exports = {
  getBrowser,
  closeBrowser,
  firstPage,
  newPage,
  selectorCount,
  selectorsCountMax,
  selectorWait,
  selectorsAnyWait,
};
