---
category: Changed
audience: public
---

**The person form is tidier, and a ZIP code fills in the town.** `HonorificField` rows carry the whole line they leave as their `label`, because the combobox writes the chosen row's label into the input: picking "Jr." then "Esq." had shown "Esq." alone while the record held "Jr., Esq.". `LabelledField` now renders an error `sr-only` and as the control's `title`, and `input.css` / `combobox.css` paint `aria-invalid` controls with `status-danger`, so no field grows a line of text under it. `AddressFields` puts the country last and marks a malformed postal code as invalid rather than hinting. New Person's other names are full name blocks opened by Add Other Name (`filledOtherNames` drops empty ones); the address, identifier and organization entry rows start as Add buttons; the contact and address "Use" is labelled "Type"; and the address place/mailing choice is no longer asked (a new address is recorded as physical). `@magna-carta/address-formats/us-postal-places` adds `usPostalPlaceFor`, generated from the GeoNames postal-code file (CC BY 4.0) and loaded lazily.

## Public

**Entering a person is quicker and calmer.** Typing a United States ZIP code first now fills in the city and the state. Fields with a mistake turn red instead of printing a message that pushes the form around; hover over one to read what is wrong. A person's other names (a maiden name, an alias) open with every name field, prefixes and suffixes included, through an Add Other Name button, and addresses, identifiers and organizations each start as an Add button so the form shows only what you use. Several prefixes or suffixes now all show in the box as you pick them. The country is the last line of an address and starts as the United States, and a contact's or address's "Use" is now called "Type".
