// The protect() enforcement chokepoint: the single seam through which encrypted fields are sealed
// on write and opened on read, so no protected value reaches storage in the clear. Ties together
// the envelope, key hierarchy, and blind indexes.
export {};
