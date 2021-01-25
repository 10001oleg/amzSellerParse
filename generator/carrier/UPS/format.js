"use strict";

const { stateCorrect } = require(__dirname + "/../../lib/stateCorrection");

/** build JSON object of Address
 * @param {Object} opts Options of function scope
 * @param {string} opts.logPrefix logPrefix for console output
 * @param {Object} objAddress eliStandart address
 * @param {string} objAddress.postalCode eliStandart address
 * @param {string} objAddress.stateOrProvinceCode eliStandart address
 * @param {string} objAddress.city eliStandart address
 * @param {string} objAddress.streetLine1 eliStandart address
 * @param {boolean?} addResidential need include Residential field in output
 * @returns {Object} jsonAddress The JSON Address object
 * @returns {string[]} jsonAddress.AddressLine AddressLines
 * @returns {string} jsonAddress.StateProvinceCode StateProvinceCode
 * @returns {string} jsonAddress.PostalCode PostalCode
 * @returns {string} jsonAddress.CountryCode CountryCode
 */
const buildJsonAddress = (opts, objAddress, addResidential = true) => {
  /*
    "address": {
      "countryCode": "US", //optional, use "US" if not
      "postalCode": "91606-3537",
      "stateOrProvinceCode": "CA",
      "city": "NORTH HOLLYWOOD",
      "streetLine1": "3084 Santeetlah Rd",
      "streetLine2": "", // optional
      "streetLine3": "", // optional
      "residential": true
    }

    Address: {
      AddressLine: objRequest.shipper.address.,
      City: fromCity,
      StateProvinceCode: fromState,
      PostalCode: fromPostalCode.toString(),
      CountryCode: "US",
    },
  */
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } getJsonAddress()`;
  if (opts && opts.isRates === true) {
    if (
      !(
        objAddress.postalCode ||
        (objAddress.stateOrProvinceCode &&
          objAddress.city &&
          objAddress.streetLine1)
      )
    ) {
      throw Error(
        logPrefix +
          " No field postalCode or (stateOrProvinceCode & city & streetLine1)"
      );
    }
  } else {
    // prettier-ignore
    {
    if (!objAddress.postalCode)          throw Error(logPrefix + " No field postalCode");
    if (!objAddress.stateOrProvinceCode) throw Error(logPrefix + " No field stateOrProvinceCode");
    if (!objAddress.city)                throw Error(logPrefix + " No field city");
    if (!objAddress.streetLine1)         throw Error(logPrefix + " No field streetLine1");
    if (addResidential && ! ("residential" in objAddress)) throw Error(logPrefix + " No field residential");
    }
  }

  const addr = [
    objAddress.streetLine1,
    objAddress.streetLine2,
    objAddress.streetLine3,
  ]
    .filter((e) => e != undefined && e != null)
    .map((e) => e.trim().replace(/  +/g, "").substring(0, 35).trim());
  const result = {
    ...(addr.length > 0
      ? { AddressLine: addr.length > 1 ? addr : addr[0] }
      : {}),
    ...(objAddress.city ? { City: objAddress.city } : {}),
    ...(objAddress.stateOrProvinceCode
      ? { StateProvinceCode: stateCorrect(objAddress.stateOrProvinceCode) }
      : {}),
    PostalCode: objAddress.postalCode.toString(),
    CountryCode: objAddress.countryCode ? objAddress.countryCode : "US",
  };
  if (addResidential) {
    // This field is a flag to indicate if the receiver is a residential location.
    // Type: String
    // True if ResidentialAddressIndicator tag exists.
    // Max Allowed: 1
    // This is an empty tag, any value inside is ignored.
    if (objAddress.residential === true || objAddress.residential === "true")
      result.ResidentialAddressIndicator = "TRUE";
  }
  return result;
};
/** build JSON object of Constact
 * @param {Object} opts Options of function scope
 * @param {string} opts.logPrefix logPrefix for console output
 * @param {Object} objContact eliStandart contact
 * @param {string} objContact.name eliStandart contact
 * @param {string} objContact.companyName eliStandart contact
 * @param {string} objContact.phone eliStandart contact
 * @param {string} objContact.email eliStandart contact
 * @param {string} objContact.phoneExtension eliStandart contact
 * @returns {Object} jsonContact The JSON Contact object
 */
const buildJsonContact = (opts, objContact) => {
  /*
    "contact": {
      "companyName": "my company name", //optional
      "name": "employee name",
      "phone": "employee phone",
      "email": "employee phone" //optional
    },

    Result:
    {
      Name: objRequest.shipper.contact.name,
      //AttentionName: "AttentionName", // Required: Cond. if ShipFrom tag is in the request and Invoice or CO
      // International forms is requested.
      //TaxIdentificationNumber: "TaxID", // Required: Cond
      // Conditionally required if EEI form (International forms) is requested.
      CompanyDisplayableName: objRequest.shipper.contact.companyName, //Required: No
      Phone: {
        Number: objRequest.shipper.contact.toString(), // Required: Yes*
        Extension: objRequest.shipper.contact.phoneExtension // Required: No
      },
      //FaxNumber: "1234567999", // Required: No
      //TaxIdentificationNumber: "456999", // Shipper’s Tax Identification Number.
      //Conditionally required if EEI form (International forms) is requested and ship From is not mentioned.
    }
*/
  // prettier-ignore
  let result = {};

  const phoneMatch =
    objContact.phone && objContact.phone.match(/^(.*) *ext\.* *(.*)$/i);
  if (phoneMatch && phoneMatch[1] && phoneMatch[2]) {
    try {
      objContact = { ...objContact };
      objContact.phone = phoneMatch[1]
        .replace(/^\+1 */, "")
        .trim()
        .substring(0, 13);
      objContact.phoneExtension = phoneMatch[2].trim();
      if (objContact.phoneExtension.length == 5) {
        objContact.phone += " " + objContact.phoneExtension.substring(0, 1);
        objContact.phoneExtension = objContact.phoneExtension.substring(1, 10);
      }
    } catch (err) {
      //
    }
  }
  if (objContact.phone && objContact.phone.toString().length > 15) {
    objContact.phone = objContact.phone
      .replace(/[^0-9 _-]/g, "")
      .trim()
      .substring(0, 15);
  }

  if (
    objContact &&
    objContact.phone &&
    objContact.phone.replace(/[^0-9]/g, "").length < 10
  ) {
    delete objContact.phone;
  }

  if ("companyName" in objContact) {
    //result.CompanyDisplayableName = objContact.companyName;
    result.Name = objContact.companyName
      .trim()
      .replace(/  +/g, "")
      .substring(0, 35)
      .trim();
  } else if ("name" in objContact) {
    result.Name = objContact.name
      .trim()
      .replace(/  +/g, "")
      .substring(0, 35)
      .trim();
  } else {
    throw Error("Contact do not contains name or companyName");
  }
  if ("phone" in objContact) {
    if (!result.Phone) {
      result.Phone = {};
    }
    result.Phone.Number = objContact.phone.toString();
  }
  if ("phoneExtension" in objContact) {
    if (!result.Phone) {
      result.Phone = {};
    }
    result.Phone.Extension = objContact.phoneExtension.toString();
  }
  try {
    if (
      result.Phone &&
      result.Phone.Number &&
      typeof result.Phone.Number == "string" &&
      result.Phone.Number.length < 10
    ) {
      delete result.Phone;
    }
  } catch (err) {
    console.error("Can not length check phone number");
  }

  if ("email" in objContact && objContact.email.trim().length <= 50)
    result.EMailAddress = objContact.email.trim();

  return result;
};

const buildJsonPackageLineItemOne = (
  opts,
  objPackage,
  sequenceID,
  writeCustomerReference = false
) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } buildJsonPackageLineItemOne()`;
  // prettier-ignore
  {
  if (!objPackage.weight)              throw Error(logPrefix + " No field weight");
  if (!objPackage.dimensions)          throw Error(logPrefix + " No field dimensions");
  if (!objPackage.dimensions.length)   throw Error(logPrefix + " No field dimensions.length");
  if (!objPackage.dimensions.width)    throw Error(logPrefix + " No field dimensions.width");
  if (!objPackage.dimensions.height)   throw Error(logPrefix + " No field dimensions.height");
  }

  // TODO
  /*
  Code Description
  AJ Accounts Receivable Customer Account
  AT Appropriation Number
  BM Bill of Lading Number
  9V Collect on Delivery (COD) Number
  ON Dealer Order Number
  DP Department Number
  3Q Food and Drug Administration (FDA) Product Code
  IK Invoice Number
  MK Manifest Key Number
  MJ Model Number
  PM Part Number
  PC Production Code
  PO Purchase Order Number
  RQ Purchase Request Number
  RZ Return Authorization Number
  SA Salesperson Number
  SE Serial Number
  ST Store Number
  TN Transaction Reference Number
  */

  const customerReferences = [];
  if (
    writeCustomerReference &&
    typeof objPackage.customerReferences == "object"
  ) {
    Object.entries(objPackage.customerReferences).map(([key, value]) => {
      if (key == "invoiceNumber") {
        customerReferences.push({
          Value: value.trim().substring(0, 35),
          Code: "PO",
        });
      } else if (key == "customerReference") {
        customerReferences.push({
          Value: value.trim().substring(0, 35),
          Code: "PM",
        });
      } else {
        console.error(
          "%s CRITICAL customerReferences type unknown %s = %s",
          logPrefix,
          key,
          value
        );
      }
    });
  }

  const result = {
    //Description: "International Goods", //Required: Cond // Required for shipment with return service.
    /* */
    Dimensions: {
      // Required: Cond // Note: Currently dimensions are not applicable to Ground Freight Pricing.
      UnitOfMeasurement: { Code: "IN" },
      Length: (+objPackage.dimensions.length).toFixed(2),
      Width: (+objPackage.dimensions.width).toFixed(2),
      Height: (+objPackage.dimensions.height).toFixed(2),
    },

    PackageWeight: {
      UnitOfMeasurement: { Code: "LBS" },
      Weight: (+objPackage.weight).toString(),
    },
    //PackageServiceOptions: "", // Required: No, it is cntainercontainer, ex. notification by Email
    ReferenceNumber: customerReferences,
  };
  result[opts.isRates ? "PackagingType" : "Packaging"] = {
    Code: "02",
    // 01 = UPS Letter
    // 02 = Customer Supplied Package
    // 03 = Tube 04 = PAK
    // 21 = UPS Express Box
    // 24 = UPS 25KG Box
    // 25 = UPS 10KG Box
    // 30 = Pallet
    // 2a = Small Express Box
    // 2b = Medium Express Box 2c = Large Express Box
    // 56 = Flats
    // 57 = Parcels
    // 58 = BPM
    // 59 = First Class
    // 60 = Priority
    // 61 = Machineables
    // 62 = Irregulars
    // 63 = Parcel Post
    // 64 = BPM Parcel
    // 65 = Media Mail
    // 66 = BPM Flat
    // 67 = Standard Flat.
  };

  return result;
};

const buildJsonPackageLineItems = (
  opts,
  objPackages,
  sequenceIDstart,
  writeCustomerReference = false
) => {
  if (!opts) opts = {};
  // prettier-ignore
  const logPrefix = `${ opts.logPrefix ? opts.logPrefix : "" } buildJsonPackageLineItems()`;
  const optsStack = { ...opts, logPrefix };

  return objPackages
    .filter((e) => !("enabled" in e && e.enabled === false))
    .map((p, i) =>
      buildJsonPackageLineItemOne(
        optsStack,
        p,
        i + sequenceIDstart ? sequenceIDstart : 1,
        writeCustomerReference
      )
    );
};
module.exports = {
  buildJsonContact,
  buildJsonAddress,
  buildJsonPackageLineItems,
};
