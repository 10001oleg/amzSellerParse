"use strict";

const parser = require("xml2json");
const mFunc = require("../../lib/mFunc");
const externalAccount = require("../../db/external_account");
const mydb = require("../../lib/mydb");
const request = require("./request");

const { requestFedex } = require("./request");

const buildXmlRateRequest = (opts, account, objRequest) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } buildXmlRateRequest()`;
  const optsStack = { ...opts, logPrefix };

  // prettier-ignore
  return `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope 
    xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:ns="http://fedex.com/ws/addressvalidation/v4">
    <soap:Body>
      <ns:AddressValidationRequest xmlns:ns="http://fedex.com/ws/addressvalidation/v4" xmlns="http://fedex.com/ws/addressvalidation/v25">
        ${request.xmlPreamble(opts, account)}
        <ns:Version>
          <ns:ServiceId>aval</ns:ServiceId>
          <ns:Major>4</ns:Major>
          <ns:Intermediate>0</ns:Intermediate>
          <ns:Minor>0</ns:Minor>
        </ns:Version>
        <!--Optional:
        <ns:InEffectAsOfTimestamp>2020-06-28T21:04:19.265Z</ns:InEffectAsOfTimestamp>-->
        <ns:AddressesToValidate>
           <ns:Address>
              <ns:StreetLines>1728 S La Cienega Blvd</ns:StreetLines>
              <ns:City>Los Angeles</ns:City>
              <ns:StateOrProvinceCode>CA</ns:StateOrProvinceCode>
              <ns:PostalCode>90035</ns:PostalCode>
              <ns:CountryCode>US</ns:CountryCode>
           </ns:Address>
        </ns:AddressesToValidate>
      </ns:AddressValidationRequest>
    </soap:Body>
  </soap:Envelope>
  `;
};

const handler = async (opts, carrier_id, objRequest) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } FEDEX_rates()`;
  const optsStack = { ...opts, logPrefix };
  let client = mydb;
  if (opts.client) {
    client = opts.client;
  }

  let carrierData;
  if (opts.carrierData) {
    carrierData = opts.carrierData;
  }
  if (!carrierData) {
    // get data of carrier
    const resCarrier = await client.query(
      'SELECT * FROM "carrier" WHERE "carrier_id" = $1',
      [carrier_id]
    );
    if (!resCarrier || !resCarrier.rowCount) {
      throw Error(logPrefix + "can not get carrier data");
    }
    carrierData = resCarrier.rows[0];
  }

  if (!carrierData.carrier_type) {
    throw Error("carrierData not loaded");
  }

  if (!carrierData.carrier_type.match(/FEDEX/)) {
    throw Error(
      `use carrier_id with type '${carrierData.carrier_type}' but library FEDEX`
    );
  }

  // get date via db/external_account
  const account = await externalAccount.get(optsStack, carrierData.cred_id);
  if (!account) {
    throw Error(logPrefix + "can not get account data");
  }

  const xmlRequest = buildXmlRateRequest(opts, account, objRequest);
  let httpResponse;
  httpResponse = await requestFedex(optsStack, account.cred, {}, xmlRequest);
  const xmlResponse = httpResponse.origBody;
  const objResponse = parser.toJson(xmlResponse, { object: true });
  console.log(objResponse);
};

module.exports = {
  handler,
};
