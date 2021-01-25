"use strict";

const externalAccount = require("../../db/external_account");
const mFunc = require("../../lib/mFunc");
const mydb = require("../../lib/mydb");
const { requestUPS } = require("./request");

const upsAddrValRequestParams = {
  path:
    "/addressvalidation/v1/1?regionalrequestindicator=true&maximumcandidatelistsize=3",
};

// const params = {
//   path:
//     //"/addressvalidation/v1/1?regionalrequestindicator=true&maximumcandidatelistsize=5",
//     "/addressvalidation/v1/1?regionalrequestindicator=true&maximumcandidatelistsize=3",
//   //"/addressvalidation/v1/3?regionalrequestindicator=false&maximumcandidatelistsize=5",
// };
/*
regionalrequestindicator - Valid values: True or False.
If True, either the region element or any combination of Political Division 1, Political Division 2, PostcodePrimaryLow
and the PostcodeExtendedLow fields will be recognized for validation in addition to the urbanization element. 
If False or no indicator, street level address validation is provided

maximumcandidatelistsize - Valid values: 0 – 50
The maximum number of Candidates to return for this request. If not provided, the default size of 15 is returned.

*/
/*
// Пример формата, которым должен быть отправлен адрес почтовой службе
const exampleUpperRequest = {
  XAVRequest: {
    AddressKeyFormat: {
      ConsigneeName: "RITZ CAMERA CENTERS-1749",
      BuildingName: "Innoplex",
      AddressLine: ["105 wall street", "STE D", "ALISO VIEJO TOWN CENTER"],
      Region: "ROSWELL,GA,30076-1521",
      PoliticalDivision2: "ALISO VIEJO", // City or Town name.
      PoliticalDivision1: "CA", // State or Province/Territory name
      PostcodePrimaryLow: "10001", // Postal Code.
      PostcodeExtendedLow: "1521", // 4 digit Postal Code extension. For US use only.
      Urbanization: "porto arundal", // Puerto Rico Political Division 3. Only valid for Puerto Rico.
      CountryCode: "US", // Country/Territory Code
    },
  },
};
// Пример формата первого параметра
const testAddrval = {
  //APItype: "CreateMultiShipmentLabel", // not required
  Address: {
    StreetLines: ["1728 S La Cienega Blvd"],
    City: "Los Angeles",
    StateOrProvinceCode: "CA",
    PostalCode: 90035,
  },
};

reqParam:
{
  "countryCode": "US",
  "postalCode": "90640",
  "stateOrProvinceCode": "CA",
  "city": "MONEBELLO",
  "streetLine1": "416 S 6TH ST",
  "streetLine2": "APT 123",
  "residential": true
}


*/
const validateCity = async (opts, carrier_id, reqAddress) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } UPS_ship()`;
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

  if (!carrierData.carrier_type.match(/UPS$/)) {
    throw Error(
      `use carrier_id with type '${carrierData.carrier_type}' but library UPS`
    );
  }

  // get date via db/external_account
  const account = await externalAccount.get(optsStack, carrierData.cred_id);
  if (!account) {
    throw Error(logPrefix + "can not get account data");
  }

  const zipMatch = reqAddress.postalCode.toString().match(/^([^-]*)-([^-]*)$/);
  const akvPartPostalCode = zipMatch
    ? { PostcodePrimaryLow: zipMatch[1], PostcodeExtendedLow: zipMatch[2] }
    : { PostcodePrimaryLow: reqAddress.postalCode.toString() };

  const akv = {
    CountryCode: reqAddress.countryCode || "US",
    ...akvPartPostalCode,
    ...(reqAddress.stateOrProvinceCode
      ? { PoliticalDivision1: reqAddress.stateOrProvinceCode }
      : {}),
    ...(reqAddress.city ? { PoliticalDivision2: reqAddress.city } : {}),
    ...(reqAddress.streetLine1 ? { AddressLine: reqAddress.streetLine1 } : {}),
  };
  const upsPostBody = JSON.stringify({ XAVRequest: { AddressKeyFormat: akv } });
  // or equivalent
  // const upsPostBody =
  //   '{"XAVRequest":{"AddressKeyFormat":' + JSON.stringify(akv) + "}}";
  let tmpJSON = undefined;
  const loopAttemptCount = 3;
  for (let attempt = 1; attempt <= loopAttemptCount && !tmpJSON; attempt++) {
    try {
      const res = await requestUPS(
        optsStack,
        account.cred,
        upsAddrValRequestParams,
        upsPostBody
      );
      if (res.statusCode !== 200) {
        throw Error("Failed answer from service");
      }
      try {
        tmpJSON = res.body;
      } catch (err) {
        throw "JSON parse";
      }
    } catch (err) {
      console.error(
        "%s Error: %s\n%sStack: %s",
        logPrefix,
        err.message,
        err.stack
      );
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
  if (!tmpJSON) {
    // Это явным образом указывает на то, что несмотря на все попытки результат HTTP не получен
    return {
      success: "FAIL",
      indicator: "Unknown",
      message: "Can't get response from outside API",
    };
  }
  //const responseBody = await request.handler(upsPostBody, params);
  let result = undefined;
  try {
    //const tmpJSON = JSON.parse(responseBody);
    /*
    console.log(logPrefix + "Request:  " + JSON.stringify(akv));
    console.log(
      logPrefix + "Response: " +
        JSON.stringify(tmpJSON.XAVResponse ? tmpJSON.XAVResponse : tmpJSON)
    );
    */
    if (tmpJSON.XAVResponse) {
      const xavResponse = tmpJSON.XAVResponse;
      const xavIndicator =
        "ValidAddressIndicator" in xavResponse
          ? "Valid"
          : "AmbiguousAddressIndicator" in xavResponse
          ? "Ambiguous"
          : "NoCandidatesIndicator" in xavResponse
          ? "NoCandidates"
          : "Unknown";

      const xavCandidate = xavResponse.Candidate;
      const candidate =
        xavCandidate === undefined
          ? []
          : mFunc.forceArray(xavCandidate).flatMap((e) =>
              e.AddressKeyFormat
                ? [
                    {
                      countryCode: e.AddressKeyFormat.CountryCode,
                      postalCode:
                        e.AddressKeyFormat.PostcodePrimaryLow.toString() +
                        (e.AddressKeyFormat.PostcodeExtendedLow
                          ? `-${e.AddressKeyFormat.PostcodeExtendedLow}`
                          : ""),
                      a: e.AddressKeyFormat.PostcodePrimaryLow,
                      stateOrProvinceCode:
                        e.AddressKeyFormat.PoliticalDivision1,
                      city: e.AddressKeyFormat.PoliticalDivision2,
                    },
                  ]
                : []
            );

      const responseCode =
        xavIndicator != "Unknown" &&
        xavResponse &&
        xavResponse.Response &&
        xavResponse.Response.ResponseStatus &&
        xavResponse.Response.ResponseStatus.Code
          ? 1
          : 0;
      return {
        success: responseCode ? "OK" : "FAIL",
        indicator: xavIndicator,
        candidate: candidate,
        ...(xavIndicator != "Unknown" ? {} : { xavResponse: xavResponse }),
      };
    }
    if (tmpJSON.response && tmpJSON.response.errors) {
      console.log(
        logPrefix + "Address validation response contains errors information"
      );
      return {
        success: "FAIL",
        errors: tmpJSON.response.errors,
      };
    }
    console.log(logPrefix + "Fail address validation response");
    return {
      success: "FAIL",
      message: "Unknown response",
    };
  } catch (err) {
    console.error(logPrefix + "Error: " + err.message, "\nStack: " + err.stack);
    return {
      ResponseStatus: "FAIL",
      message: err.message,
      stack: err.stack, // TODO: only for debug
    };
  }
};

module.exports = {
  validateCity,
};
