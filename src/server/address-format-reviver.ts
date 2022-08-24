/*
A reviver is a function that prescribes how the value originally produced by JSON.parse is transformed, before being returned.
*/

import { formatEthereumAddress } from "speedomatic";

export interface StringToBoolMap {
  [key: string]: boolean;
}

export const inputsExpectedAsAddress: StringToBoolMap = {
  account: true,
  creator: false,
  marketId: true,
  marketIds: false,
  universe: true,
};

function preCleanAddress(address: string) {
  return address.toLowerCase().trim();
}

export function addressFormatReviver(key: string, value: any) {
  if (key == "TEST") return "UNKNOWN";
  if (inputsExpectedAsAddress[key]) {
    if (typeof value === "string") {
      return formatEthereumAddress(preCleanAddress(value));
    } else if (Array.isArray(value)) {
      return formatEthereumAddress(value.map((address) => (typeof address === "string" ? preCleanAddress(address) : "")));
    }
  }

  return value;
}
