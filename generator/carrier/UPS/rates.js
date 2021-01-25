"use strict";

const { buildJsonAddress, buildJsonPackageLineItems } = require("./format");
// const mydb = require("../../lib/mydb");
const { requestUPS } = require("./request");
const mFunc = require("../../lib/mFunc");

const upsRateRequestParams = {
  path: "/ship/v1801/rating/Rate?additionalinfo=timeintransit",
};
/*
/ship/{version}/rating/{requestoption}?additionalinfo=timeintransit

**requestoption**
Rate = The server rates (The default Request option is Rate if a Request Option is not provided).
Shop = The server validates the shipment, and returns rates for all UPS products from the ShipFrom to the ShipTo addresses.
Rate is the only valid request option for UPS Ground Freight Pricing requestsrequestoption

*/

const buildUpsRateObject = (opts, account, objRequest) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } buildUpsRateObject()`;
  const optsStack = {
    ...opts,
    logPrefix,
    isRates: true, // need for format object patch
  };
  const upsObject = {
    RateRequest: {
      Request: {
        SubVersion: "1801",
        TransactionReference: {
          CustomerContext: "",
        },
      },
      PickupType: {
        Code: "01",
        // Valid values:
        // 01 - Daily Pickup (Default - used when an invalid pickup type code is provided)
        // 03 - Customer Counter
        // 06 - One Time Pickup
        // 19 - Letter Center
        // 20 - Air Service Center Length is not validated. When negotiated rates are requested,
        // 07 (onCallAir) will be ignored.
        // Refer to the Rate Types Table in the Appendix for rate type based on Pickup Type and Customer Classification Code.
      },
      Shipment: {
        DeliveryTimeInformation: { PackageBillType: "03" },
        Shipper: {
          ShipperNumber: account.cred.accountNumber,
          // ...buildJsonContact(optsStack, objRequest.shipper.contact),
          Address: buildJsonAddress(
            optsStack,
            objRequest.shipper.address,
            false
          ),
        },
        ShipFrom: {
          // ...buildJsonContact(optsStack, objRequest.shipper.contact),
          Address: buildJsonAddress(
            optsStack,
            objRequest.shipper.address,
            true
          ),
        },
        ShipTo: {
          // ...buildJsonContact(optsStack, objRequest.recipient.contact),
          Address: buildJsonAddress(
            optsStack,
            objRequest.recipient.address,
            true
          ),
        },
        /*
        PaymentInformation: {
          ShipmentCharge: {
            Type: "01",
            BillShipper: {
              AccountNumber: account.cred.accountNumber,
            },
          },
        },
        */
        Service: {
          Code: "03",
        },
        ShipmentTotalWeight: {
          UnitOfMeasurement: {
            Code: "LBS",
            Description: "Pounds",
          },
          Weight: objRequest.packages
            .reduce((a, { weight }) => (a += weight), 0)
            .toFixed(2),
        },
        Package: buildJsonPackageLineItems(
          optsStack,
          objRequest.packages,
          objRequest.sequenceID,
          false
        ),
        //ItemizedChargesRequestedIndicator: "", //!!! NO In documentation
        //RatingMethodRequestedIndicator: "", //Required: No
        //TaxInformationIndicator: "", //Required: No
        ShipmentRatingOptions: {
          UserLevelDiscountIndicator: "TRUE", // TRUE exists into example
          /*
          UserLevelDiscountIndicator - required to obtain rates for
          User Level Promotions.
          This is required to obtain User Level Discounts. There
          must also be no ShipperNumber in the Shipper container
          */
          //FRSShipmentIndicator: " ",
          /*
          FRS Indicator. The indicator is required to obtain rates for
          UPS Ground Freight Pricing (GFP).
          The account number must be enabled for GFP.
          */
          //RateChartIndicator: " ",
          /*
          RateChartIndicator - If present in a request, the response
          will contain a RateChart element.
          */
          // Required: No
          NegotiatedRatesIndicator: "", // "" - eq. example request into documantation
        },
      },
    },
  };
  return upsObject;
};

const handler = async (opts, carrier_id, objRequest) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } UPS_rates()`;
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

  if (!carrierData.carrier_type.match(/UPS$/)) {
    throw Error(
      `use carrier_id with type '${carrierData.carrier_type}' but library UPS`
    );
  }

  if (!carrierData.cred) throw Error("NO carrierData.cred object");

  const upsObject = buildUpsRateObject(opts, carrierData, objRequest);
  const upsPostBody = JSON.stringify(upsObject);

  let httpResponse = undefined;
  const loopAttemptCount = 3;
  for (
    let attempt = 1;
    attempt <= loopAttemptCount && (!httpResponse || !httpResponse.origBody);
    attempt++
  ) {
    try {
      httpResponse = await requestUPS(
        optsStack,
        carrierData.cred,
        upsRateRequestParams,
        upsPostBody
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

  let result = undefined;
  try {
    const tmpJSON = httpResponse.body;
    if (tmpJSON.response) {
      if (tmpJSON.response.errors) {
        result = [
          {
            error: "Error answer from carrier",
            ...tmpJSON.response,
          },
        ];
      } else {
        result = [
          {
            error: "Error format answer from carrier",
            errors: [{ code: "-2", message: "Unknown error" }],
            response: tmpJSON.response,
          },
        ];
      }
    } else if (tmpJSON.RateResponse) {
      let rateItem = {};
      const RatedShipment = tmpJSON.RateResponse.RatedShipment;
      const arrivalTime =
        RatedShipment.TimeInTransit.ServiceSummary.EstimatedArrival.Arrival;

      let amountBase = +RatedShipment.TotalCharges.MonetaryValue;
      let amountWithTaxes = +RatedShipment.TotalCharges.MonetaryValue * 2;
      if (
        RatedShipment.NegotiatedRateCharges &&
        RatedShipment.NegotiatedRateCharges.TotalCharge &&
        RatedShipment.NegotiatedRateCharges.TotalCharge.MonetaryValue
      ) {
        amountWithTaxes = +RatedShipment.NegotiatedRateCharges.TotalCharge
          .MonetaryValue;
      }

      rateItem = {
        ServiceType: "UPS Ground",
        DeliveryTimestamp:
          arrivalTime.Date.replace(/(20..)(..)(..)/, "$1-$2-$3") +
          "T" +
          arrivalTime.Time.replace(/(..)(..)(..)/, "$1:$2:$3") +
          ".000Z",
        RateZone: "??",
        TotalBillingWeight: +RatedShipment.BillingWeight.Weight,
        TotalBaseCharge: amountBase,
        TotalNetChargeWithDutiesAndTaxes: amountWithTaxes,
        carrierResponse: RatedShipment,
      };
      rateItem.packages = mFunc
        .forceArray(RatedShipment.RatedPackage)
        .map((e) => ({
          ServiceType: rateItem.ServiceType,
          DeliveryTimestamp: rateItem.DeliveryTimestamp,
          RateZone: rateItem.RateZone,
          TotalBillingWeight: +e.BillingWeight.Weight,
          TotalBaseCharge: +e.TotalCharges.MonetaryValue,
          TotalNetChargeWithDutiesAndTaxes:
            (amountWithTaxes / amountBase) * +e.TotalCharges.MonetaryValue,
        }));

      // check address classification Alert
      if (
        tmpJSON.RateResponse.Response &&
        tmpJSON.RateResponse.Response.Alert &&
        typeof tmpJSON.RateResponse.Response.Alert == "object"
      ) {
        const alerts = mFunc
          .forceArray(tmpJSON.RateResponse.Response.Alert)
          .flatMap((alert) => {
            return alert &&
              alert.Description.match(/Address Classification is changed/i)
              ? [alert.Description]
              : [];
          });
        if (alerts.length > 0) {
          rateItem.addressClassificationAlert = alerts;
        }
      }

      result = [rateItem];
    } else {
      console.error(
        logPrefix + "Error format answer from carrier UPS. Response: ",
        tmpJSON
      );
      result = [
        {
          error: "Error format answer from carrier",
          //response: tmpJSON,
        },
      ];
    }
  } catch (err) {
    console.error("CATCH eror message: " + err.message, "Stack: " + err.stack);
    result = [
      {
        error: "Unknown error. JSON parse fail",
        message: err.message,
      },
    ];
  }

  return result;
};

module.exports = {
  handler,
};
