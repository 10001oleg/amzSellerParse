"use strict";

const parser = require("xml2json");
const mFunc = require("../../lib/mFunc");
// const mydb = require("../../lib/mydb");
// const externalAccount = require("../../db/external_account");

const {
  buildXmlContact,
  buildXmlAddress,
  buildXmlPackageLineItems,
} = require("./format");
const { requestFedex, xmlPreamble } = require("./request");

const buildXmlRateRequest = (opts, account, objRequest) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } buildXmlRateRequest()`;
  const optsStack = { ...opts, logPrefix, isRates: true };

  // prettier-ignore
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns="http://fedex.com/ws/rate/v26">
  <soap:Body>
    <ns:RateRequest xmlns:ns="http://fedex.com/ws/rate/v26" xmlns="http://fedex.com/ws/rate/v26">
      ${xmlPreamble(opts, account)}
      <ns:Version>
        <ns:ServiceId>crs</ns:ServiceId>
        <ns:Major>26</ns:Major>
        <ns:Intermediate>0</ns:Intermediate>
        <ns:Minor>0</ns:Minor>
      </ns:Version>
      <ns:ReturnTransitAndCommit>${objRequest.returnTransitAndCommit?"true":"false"}</ns:ReturnTransitAndCommit>
      ${objRequest.carrierCodes.map((e)=>"<ns:CarrierCodes>"+e+"</ns:CarrierCodes>").join("\n")}
      <ns:RequestedShipment>
        <ns:ShipTimestamp>${new Date().toISOString().replace(/\.[0-9][0-9][0-9]Z$/, "+00:00")}</ns:ShipTimestamp>
        <ns:DropoffType>${objRequest.dropoffType}</ns:DropoffType>
        <ns:PackagingType>${objRequest.packagingType}</ns:PackagingType>
        <ns:Shipper>
          ${buildXmlContact({...optsStack, logPrefix: logPrefix+" shipper"}, objRequest.shipper.contact)}
          ${buildXmlAddress({...optsStack, logPrefix: logPrefix+" shipper"}, objRequest.shipper.address, false)}
        </ns:Shipper>
        <ns:Recipient>
          ${buildXmlContact({...optsStack, logPrefix: logPrefix+" recipient"}, objRequest.recipient.contact)}
          ${buildXmlAddress({...optsStack, logPrefix: logPrefix+" recipient"}, objRequest.recipient.address)}
        </ns:Recipient>
        <ns:ShippingChargesPayment>
          <ns:PaymentType>${objRequest.shippingChargesPayment}</ns:PaymentType>
          <ns:Payor>
            <ns:ResponsibleParty>
              <ns:AccountNumber>${account.cred.account_number}</ns:AccountNumber>
            </ns:ResponsibleParty>
          </ns:Payor>
        </ns:ShippingChargesPayment>
        <ns:PackageCount>${objRequest.packages.length}</ns:PackageCount>
        ${buildXmlPackageLineItems(optsStack, objRequest.packages, 1, false)}
      </ns:RequestedShipment>
    </ns:RateRequest>
  </soap:Body>
</soap:Envelope>`;
};

const handler = async (opts, carrier_id, objRequest) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } FEDEX_rates()`;
  const optsStack = { ...opts, logPrefix };

  // prettier-ignore
  {
  if (!objRequest.packages) throw Error(logPrefix + "no packages in request");
  if (!objRequest.shippingChargesPayment) throw Error(logPrefix + "no shippingChargesPayment in request");
  if (!objRequest.shipper)                throw Error(logPrefix + "no shipper in request");
  // if (!objRequest.shipper.contact)        throw Error(logPrefix + "no shipper contact in request");
  if (!objRequest.shipper.address)        throw Error(logPrefix + "no shipper address in request");
  if (!objRequest.recipient)              throw Error(logPrefix + "no recipient in request");
  // if (!objRequest.recipient.contact)      throw Error(logPrefix + "no recipient contact in request");
  if (!objRequest.recipient.address)      throw Error(logPrefix + "no recipient address in request");
  }

  objRequest = {
    returnTransitAndCommit: true,
    carrierCodes: ["FDXE", "FDXG", "FXSP"],
    ...objRequest,
  };

  // let client = mydb;
  // if (opts.client) {
  //   client = opts.client;
  // }

  let carrierData;
  if (opts.carrierData) {
    carrierData = opts.carrierData;
  }
  // if (!carrierData) {
  //   // get data of carrier
  //   const resCarrier = await client.query(
  //     'SELECT * FROM "carrier" WHERE "carrier_id" = $1',
  //     [carrier_id]
  //   );
  //   if (!resCarrier || !resCarrier.rowCount) {
  //     throw Error(logPrefix + "can not get carrier data");
  //   }
  //   carrierData = resCarrier.rows[0];
  // }

  if (!carrierData.carrier_type) {
    throw Error("carrierData not loaded");
  }

  if (!carrierData.carrier_type.match(/FEDEX/)) {
    throw Error(
      `use carrier_id with type '${carrierData.carrier_type}' but library FEDEX`
    );
  }

  if (!carrierData.cred) throw Error("NO carrierData.cred object");
  try {
    const xmlRequest = buildXmlRateRequest(opts, carrierData, objRequest);

    let httpResponse = undefined;
    const loopAttemptCount = 3;
    for (
      let attempt = 1;
      attempt <= loopAttemptCount && (!httpResponse || !httpResponse.origBody);
      attempt++
    ) {
      try {
        httpResponse = await requestFedex(
          optsStack,
          carrierData.cred,
          {},
          xmlRequest
        );
      } catch (err) {
        console.error(
          logPrefix + "HTTP request failed at attempt N%s, paused %s ms...",
          attempt,
          100 * attempt
        );
        if (loopAttemptCount != attempt) {
          await new Promise((res) => setTimeout(res, 100 * attempt));
        }
      }
    }
    const xmlResponse = httpResponse.origBody
      .replace(/(<\/?)[a-z0-9]*:/g, "$1")
      .replace(/(<[^ >]+) +xmlns:[^">]+=["'][^'">]+["']/g, "$1");
    const objResponse = parser.toJson(xmlResponse, { object: true });

    const objBody = objResponse["SOAP-ENV:Envelope"]["SOAP-ENV:Body"];
    const res = objBody.RateReply;
    const errorsObjAdd =
      ["ERROR"].indexOf(res["HighestSeverity"]) >= 0
        ? {
            errors: mFunc.forceArray(res.Notifications).map((e) => ({
              status: "FAIL",
              code: e.Code,
              message: e.Message,
            })),
          }
        : {};
    const response = res.RateReplyDetails.map((e) => {
      let amountBase = -1;
      let amountWithTaxes = -1;
      let rateZone = "ERROR";
      let deliveryTimestamp = "ERROR_DELIVERY_TIMESTAMP";
      let serviceType = "ERROR_SERVICE_TYPE";
      try {
        // Получаем значения
        const shipRateDetail = e.RatedShipmentDetails.ShipmentRateDetail;
        serviceType = e.ServiceType;
        deliveryTimestamp = e.DeliveryTimestamp;
        rateZone = +shipRateDetail.RateZone;
        amountBase = +shipRateDetail.TotalBaseCharge.Amount;
        amountWithTaxes =
          shipRateDetail.TotalNetChargeWithDutiesAndTaxes.Amount;

        return {
          ServiceType: serviceType,
          DeliveryTimestamp: deliveryTimestamp,
          RateZone: rateZone,
          TotalBillingWeight: +shipRateDetail.TotalBillingWeight.Value,
          TotalBaseCharge: amountBase,
          TotalNetChargeWithDutiesAndTaxes: amountWithTaxes,
          ...errorsObjAdd,
        };
      } catch (err) {
        console.error(
          logPrefix + "Error: " + err.message,
          "\nStack: " + err.stack
        );
        return {
          error: err.message,
          ServiceType: serviceType,
          DeliveryTimestamp: deliveryTimestamp, //TODO !!!
          RateZone: rateZone,
          TotalBillingWeight: "ERROR",
          TotalBaseCharge: amountBase > 0 ? amountBase : "ERROR",
          TotalNetChargeWithDutiesAndTaxes:
            amountWithTaxes > 0 ? amountWithTaxes : "ERROR",
        };
      }
    });
    return response;
  } catch (err) {
    console.error("%s Error: %s\nStack: %s", logPrefix, err.message, err.stack);
    return [{ error: err.message }];
  }
};

module.exports = {
  handler,
};
